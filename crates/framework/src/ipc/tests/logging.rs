use super::*;

#[test]
fn admission_is_held_until_execution_log_is_written() {
    use tracing_subscriber::{Layer, layer::SubscriberExt};
    struct AdmissionAudit {
        gate: OperationGate,
        maintenance: bool,
        events: Arc<std::sync::atomic::AtomicUsize>,
    }
    impl<S: tracing::Subscriber> Layer<S> for AdmissionAudit {
        fn on_event(
            &self,
            event: &tracing::Event<'_>,
            _: tracing_subscriber::layer::Context<'_, S>,
        ) {
            if event.metadata().fields().field("outcome").is_none() {
                return;
            }
            self.events
                .fetch_add(1, std::sync::atomic::Ordering::Relaxed);
            let attempt = pin!(self.gate.quiesce()).poll(&mut Context::from_waker(Waker::noop()));
            if self.maintenance {
                assert!(
                    matches!(attempt, Poll::Ready(Err(error)) if error.code() == crate::maintenance::OPERATION_BUSY)
                );
            } else {
                assert!(attempt.is_pending(), "共享许可必须覆盖日志写入");
            }
        }
    }
    let _guard = IPC_TEST_LOCK.lock().unwrap();
    for command in ["app_test", "app_maintenance"] {
        let context = test_context(0);
        let events = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let subscriber = tracing_subscriber::registry().with(AdmissionAudit {
            gate: context.gate.clone(),
            maintenance: command == "app_maintenance",
            events: events.clone(),
        });
        tracing::subscriber::with_default(subscriber, || {
            ready(execute(&context, command, |_| async { Ok(()) })).unwrap();
        });
        assert_eq!(events.load(std::sync::atomic::Ordering::Relaxed), 1);
        drop(ready(context.gate.quiesce()).unwrap());
    }
}

#[test]
fn execution_logs_only_operation_metadata_for_all_entry_levels() {
    let _guard = IPC_TEST_LOCK.lock().unwrap();
    let bytes = Arc::new(Mutex::new(Vec::new()));
    let writer = LogBuffer(bytes.clone());
    let subscriber = tracing_subscriber::fmt()
        .json()
        .with_writer(move || writer.clone())
        .finish();
    let context = test_context(42);
    let input = "private-command-input";
    let mut expected = Vec::new();
    tracing::subscriber::with_default(subscriber, || {
        let trace = ready(execute(&context, "app_test", |invocation| async move {
            assert_eq!(input, "private-command-input");
            Ok(invocation.execution.trace_id)
        }))
        .unwrap();
        expected.push(("app_test", "success".to_owned(), trace));
        let error = ready(execute(&context, "app_test", |_| async {
            Err::<(), _>(AppError::new(INPUT_INVALID))
        }))
        .unwrap_err();
        expected.push(("app_test", error.code, error.trace_id));
        let trace = ready(execute_public(
            &context,
            "app_public",
            |invocation| async move { Ok(invocation.trace_id) },
        ))
        .unwrap();
        expected.push(("app_public", "success".to_owned(), trace));
        let trace = ready(execute_session(
            &context,
            "app_session",
            |invocation| async move { Ok(invocation.execution.trace_id) },
        ))
        .unwrap();
        expected.push(("app_session", "success".to_owned(), trace));
        for command in ["app_test_denied", "disabled_test_denied"] {
            let error = ready(execute(&context, command, |_| async {
                must_not_run("must not execute")
            }))
            .unwrap_err();
            expected.push((command, error.code, error.trace_id));
        }
    });
    let text = String::from_utf8(bytes.lock().unwrap().clone()).unwrap();
    assert!(!text.contains(input));
    let records: Vec<serde_json::Value> = text
        .lines()
        .map(|line| serde_json::from_str::<serde_json::Value>(line).unwrap())
        .filter(|record| record["fields"]["message"] == "IPC 执行")
        .collect();
    assert_eq!(records.len(), expected.len(), "{text}");
    for (record, (command, outcome, trace)) in records.iter().zip(expected) {
        let duration = record["fields"]["duration_ms"].as_i64().unwrap();
        assert!(duration >= 0);
        assert_eq!(
            record["fields"],
            serde_json::json!({
                "message": "IPC 执行", "command": command, "module": command.split_once('_').unwrap().0,
                "outcome": outcome, "trace_id": trace, "duration_ms": duration,
            })
        );
    }
}

#[test]
fn command_logs_include_context_duration_and_error_levels() {
    let _guard = IPC_TEST_LOCK.lock().unwrap();
    let bytes = Arc::new(Mutex::new(Vec::new()));
    let writer = LogBuffer(bytes.clone());
    let subscriber = tracing_subscriber::fmt()
        .json()
        .with_max_level(tracing::Level::DEBUG)
        .with_writer(move || writer.clone())
        .finish();
    tracing::subscriber::with_default(subscriber, || {
        assert_eq!(
            ready(execute(
                &test_context(42),
                "app_about_get",
                |value| async move { Ok(value.value) }
            ))
            .unwrap(),
            42
        );
        ready(execute(&test_context(0), "app_about_get", |_| async {
            Err::<(), _>(AppError::new(INPUT_INVALID).with_param("path", "logging.level"))
        }))
        .unwrap_err();
        ready(execute(&test_context(0), "app_about_get", |_| async {
            Err::<(), _>(AppError::new(INTERNAL_UNEXPECTED).with_source(
                AppError::new(INTERNAL_UNEXPECTED).with_source(io::Error::other("root cause")),
            ))
        }))
        .unwrap_err();
    });
    let text = String::from_utf8(bytes.lock().unwrap().clone()).unwrap();
    let records: Vec<serde_json::Value> = text
        .lines()
        .map(|line| serde_json::from_str::<serde_json::Value>(line).unwrap())
        .filter(|record| record["fields"]["message"] != "IPC 执行")
        .collect();
    assert_eq!(records.len(), 3, "{text}");
    for record in &records {
        assert_eq!(record["span"]["command"], "app_about_get");
        assert_eq!(
            Uuid::parse_str(record["span"]["trace_id"].as_str().unwrap())
                .unwrap()
                .get_version_num(),
            7
        );
    }
    assert_eq!(records[0]["level"], "DEBUG");
    assert!(records[0]["fields"]["elapsed_ms"].is_number());
    assert_eq!(records[1]["level"], "WARN");
    assert!(
        records[1]["fields"]["params"]
            .as_str()
            .unwrap()
            .contains("logging.level")
    );
    assert_eq!(records[2]["level"], "ERROR");
    let chain = records[2]["fields"]["source_chain"].as_str().unwrap();
    assert!(chain.contains("app.internal.unexpected"));
    assert!(chain.contains("root cause"));
}
