use super::*;

#[derive(Clone, Default)]
struct Sink(Arc<Mutex<Vec<StreamEvent<i32>>>>);
impl StreamSink<i32> for Sink {
    fn send(&self, event: StreamEvent<i32>) -> Result<(), AppError> {
        self.0.lock().unwrap().push(event);
        Ok(())
    }
}

fn owner() -> StreamOwner {
    StreamOwner {
        actor: Actor::User(Id::new()),
        scope: "main".into(),
    }
}

#[test]
fn ordered_events_use_camel_case_and_stop_at_each_terminal() {
    for ending in 0..4 {
        let registry = StreamRegistry::default();
        let sink = Sink::default();
        let stream = registry.open(owner(), sink.clone()).unwrap();
        stream.delta(10).unwrap();
        stream.delta(20).unwrap();
        stream
            .progress(
                Some(1),
                Some(2),
                Some("jobs.test".into()),
                Default::default(),
            )
            .unwrap();
        match ending {
            0 => stream.succeeded(Some(30)),
            1 => stream.failed("app.internal.unexpected".into(), Default::default()),
            2 => stream.cancelled(),
            _ => stream.unknown("jobs.test".into()),
        }
        .unwrap();
        stream.delta(99).unwrap();
        stream.succeeded(None).unwrap();
        let events = sink.0.lock().unwrap();
        assert_eq!(events.len(), 5);
        assert!(matches!(events[1], StreamEvent::Delta { seq: 0, data: 10 }));
        assert!(matches!(events[2], StreamEvent::Delta { seq: 1, data: 20 }));
        assert_eq!(
            serde_json::to_value(&events[0]).unwrap()["streamId"],
            stream.id.to_string()
        );
        assert_eq!(
            serde_json::to_value(&events[3]).unwrap()["messageKey"],
            "jobs.test"
        );
        assert!(registry.0.lock().unwrap().entries.is_empty());
    }
}

#[test]
fn cancellation_emits_once_and_drop_removes_registration() {
    let registry = StreamRegistry::default();
    let owner = owner();
    let sink = Sink::default();
    let stream = registry.open(owner.clone(), sink.clone()).unwrap();
    registry.cancel(&owner, stream.id).unwrap();
    assert!(stream.cancellation.is_cancelled());
    stream.delta(1).unwrap();
    stream.cancelled().unwrap();
    assert!(matches!(
        sink.0.lock().unwrap().as_slice(),
        [StreamEvent::Started { .. }, StreamEvent::Cancelled]
    ));
    assert!(registry.0.lock().unwrap().entries.is_empty());
    let unfinished = registry.open(owner, Sink::default()).unwrap();
    let token = unfinished.cancellation.clone();
    drop(unfinished);
    assert!(token.is_cancelled());
    assert!(registry.0.lock().unwrap().entries.is_empty());
}

#[test]
fn stream_cancel_requires_actor_and_scope() {
    let registry = StreamRegistry::default();
    let owner = owner();
    let stream = registry.open(owner.clone(), Sink::default()).unwrap();
    for other in [
        StreamOwner {
            actor: Actor::System,
            ..owner.clone()
        },
        StreamOwner {
            actor: Actor::User(Id::new()),
            ..owner.clone()
        },
        StreamOwner {
            scope: "other".into(),
            ..owner.clone()
        },
    ] {
        let error = registry.cancel(&other, stream.id).unwrap_err();
        assert_eq!(error.code(), STREAM_FORBIDDEN);
        assert!(error.params.is_empty());
        assert!(!stream.cancellation.is_cancelled());
    }
    registry.cancel(&owner, Id::new()).unwrap();
    registry.cancel(&owner, stream.id).unwrap();
    registry.cancel(&owner, stream.id).unwrap();
    assert!(stream.cancellation.is_cancelled());
    stream.cancelled().unwrap();
    registry.cancel(&owner, stream.id).unwrap();

    let first = registry.open(owner.clone(), Sink::default()).unwrap();
    let second = registry
        .open(
            StreamOwner {
                scope: "other".into(),
                ..owner
            },
            Sink::default(),
        )
        .unwrap();
    registry.cancel_scope("main").unwrap();
    registry.cancel_scope("main").unwrap();
    assert!(first.cancellation.is_cancelled());
    assert!(!second.cancellation.is_cancelled());
    assert_eq!(registry.0.lock().unwrap().entries.len(), 1);
}

#[test]
fn stream_close_serializes_with_open() {
    let registry = StreamRegistry::default();
    let first = registry.open(owner(), Sink::default()).unwrap();
    let barrier = std::sync::Barrier::new(9);
    std::thread::scope(|threads| {
        let opening: Vec<_> = (0..8)
            .map(|_| {
                threads.spawn(|| {
                    barrier.wait();
                    registry.open(owner(), Sink::default())
                })
            })
            .collect();
        barrier.wait();
        registry.close().unwrap();
        for thread in opening {
            match thread.join().unwrap() {
                Ok(stream) => assert!(stream.cancellation.is_cancelled()),
                Err(error) => assert_eq!(error.code(), STREAM_CLOSED),
            }
        }
    });
    registry.close().unwrap();
    assert!(first.cancellation.is_cancelled());
    assert!(registry.0.lock().unwrap().entries.is_empty());
    assert_eq!(
        registry
            .open(owner(), Sink::default())
            .err()
            .unwrap()
            .code(),
        STREAM_CLOSED
    );
}

#[test]
fn stream_explicit_terminal_survives_observer_cancel() {
    for ending in ["unknown", "failed", "succeeded"] {
        let registry = StreamRegistry::default();
        let owner = owner();
        let sink = Sink::default();
        let stream = registry.open(owner.clone(), sink.clone()).unwrap();
        registry.cancel(&owner, stream.id).unwrap();
        match ending {
            "unknown" => stream.unknown("jobs.streamClosed".into()),
            "failed" => stream.failed("app.input.invalid".into(), Default::default()),
            _ => stream.succeeded(Some(42)),
        }
        .unwrap();
        stream.cancelled().unwrap();
        stream.delta(99).unwrap();
        stream.succeeded(None).unwrap();
        let events = sink.0.lock().unwrap();
        assert_eq!(events.len(), 2);
        assert_eq!(serde_json::to_value(&events[1]).unwrap()["type"], ending);
        assert!(registry.0.lock().unwrap().entries.is_empty());
    }
}

struct FailingSink {
    registry: StreamRegistry,
    fail_started: bool,
    token: Arc<Mutex<Option<CancellationToken>>>,
    _lifetime: Arc<()>,
}

impl StreamSink<i32> for FailingSink {
    fn send(&self, event: StreamEvent<i32>) -> Result<(), AppError> {
        if let StreamEvent::Started { stream_id } = event {
            *self.token.lock().unwrap() = Some(
                self.registry.0.lock().unwrap().entries[&stream_id]
                    .cancellation
                    .clone(),
            );
            if !self.fail_started {
                return Ok(());
            }
        }
        Err(AppError::new(crate::error::INTERNAL_UNEXPECTED)
            .with_source(std::io::Error::other("private transport failure")))
    }
}

#[test]
fn stream_drop_and_sink_error_release_registration() {
    let registry = StreamRegistry::default();
    for fail_started in [true, false] {
        let lifetime = Arc::new(());
        let token = Arc::new(Mutex::new(None));
        let opened = registry.open(
            owner(),
            FailingSink {
                registry: registry.clone(),
                fail_started,
                token: token.clone(),
                _lifetime: lifetime.clone(),
            },
        );
        if fail_started {
            let error = opened.err().unwrap();
            assert_eq!(error.code(), crate::error::INTERNAL_UNEXPECTED);
            assert!(std::error::Error::source(&error).is_none());
        } else {
            let stream = opened.unwrap();
            let error = stream.delta(1).unwrap_err();
            assert_eq!(error.code(), crate::error::INTERNAL_UNEXPECTED);
            assert!(std::error::Error::source(&error).is_none());
            stream.succeeded(None).unwrap();
        }
        assert!(token.lock().unwrap().as_ref().unwrap().is_cancelled());
        assert!(registry.0.lock().unwrap().entries.is_empty());
        assert_eq!(Arc::strong_count(&lifetime), 1);
    }
    let stream = registry.open(owner(), Sink::default()).unwrap();
    let token = stream.cancellation.clone();
    drop(stream);
    assert!(token.is_cancelled());
    assert!(registry.0.lock().unwrap().entries.is_empty());
}

fn poison<T>(mutex: &Mutex<T>) {
    assert!(
        std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            let _guard = mutex.lock().unwrap();
            panic!("poison lock for regression test");
        }))
        .is_err()
    );
}

#[test]
fn poisoned_registry_and_state_return_errors_and_drop_cancels() {
    let registry = StreamRegistry::default();
    let stream = registry.open(owner(), Sink::default()).unwrap();
    let token = stream.cancellation.clone();
    poison(&registry.0);
    assert_eq!(
        registry
            .open(owner(), Sink::default())
            .err()
            .unwrap()
            .code(),
        INTERNAL_UNEXPECTED
    );
    assert_eq!(
        registry.cancel(&owner(), stream.id).unwrap_err().code(),
        INTERNAL_UNEXPECTED
    );
    assert_eq!(
        registry.cancel_scope("main").unwrap_err().code(),
        INTERNAL_UNEXPECTED
    );
    assert_eq!(registry.close().unwrap_err().code(), INTERNAL_UNEXPECTED);
    assert_eq!(
        stream.succeeded(None).unwrap_err().code(),
        INTERNAL_UNEXPECTED
    );
    drop(stream);
    assert!(token.is_cancelled());

    let registry = StreamRegistry::default();
    let stream = registry.open(owner(), Sink::default()).unwrap();
    let token = stream.cancellation.clone();
    poison(&stream.state);
    assert_eq!(stream.delta(1).unwrap_err().code(), INTERNAL_UNEXPECTED);
    assert_eq!(
        stream
            .progress(None, None, None, Default::default())
            .unwrap_err()
            .code(),
        INTERNAL_UNEXPECTED
    );
    assert_eq!(
        stream.succeeded(None).unwrap_err().code(),
        INTERNAL_UNEXPECTED
    );
    drop(stream);
    assert!(token.is_cancelled());
    assert!(registry.0.lock().unwrap().entries.is_empty());
}

#[test]
fn a_sink_contract_violation_does_not_cause_later_panics() {
    struct PanicSink;
    impl StreamSink<i32> for PanicSink {
        fn send(&self, event: StreamEvent<i32>) -> Result<(), AppError> {
            if matches!(event, StreamEvent::Delta { .. }) {
                panic!("sink contract violation");
            }
            Ok(())
        }
    }
    let registry = StreamRegistry::default();
    let stream = registry.open(owner(), PanicSink).unwrap();
    assert!(std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| stream.delta(1))).is_err());
    assert_eq!(stream.delta(2).unwrap_err().code(), INTERNAL_UNEXPECTED);
    assert_eq!(stream.cancelled().unwrap_err().code(), INTERNAL_UNEXPECTED);
    drop(stream);
    assert!(registry.0.lock().unwrap().entries.is_empty());
}

#[test]
fn concurrent_deltas_and_terminals_preserve_sequence_and_single_ending() {
    let registry = StreamRegistry::default();
    let sink = Sink::default();
    let stream = registry.open(owner(), sink.clone()).unwrap();
    std::thread::scope(|threads| {
        for _ in 0..8 {
            threads.spawn(|| {
                for value in 0..32 {
                    stream.delta(value).unwrap();
                }
            });
        }
    });
    std::thread::scope(|threads| {
        for _ in 0..8 {
            threads.spawn(|| stream.succeeded(None).unwrap());
        }
    });
    stream.delta(999).unwrap();
    let events = sink.0.lock().unwrap();
    assert_eq!(events.len(), 258);
    for (expected, event) in events[1..257].iter().enumerate() {
        assert!(matches!(event, StreamEvent::Delta { seq, .. } if *seq == expected as u64));
    }
    assert!(matches!(
        events.last().unwrap(),
        StreamEvent::Succeeded { .. }
    ));
}
