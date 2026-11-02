use std::sync::{
    Arc, Mutex,
    atomic::{AtomicBool, Ordering},
};
use std::time::Duration;
use tokio::sync::Barrier;

use super::*;
use crate::error::{INPUT_INVALID, INTERNAL_UNEXPECTED};

type Events = Arc<Mutex<Vec<String>>>;

async fn open(
    stack: &mut ShutdownStack,
    events: &Events,
    name: &'static str,
    fail_open: bool,
    fail_close: bool,
) -> Result<(), AppError> {
    step(name, async {
        events.lock().unwrap().push(format!("open:{name}"));
        if fail_open {
            return Err(AppError::new(INPUT_INVALID).with_param("step", name));
        }
        let events = events.clone();
        stack.push(name, move || async move {
            events.lock().unwrap().push(format!("close:{name}"));
            if fail_close {
                Err(AppError::new(INTERNAL_UNEXPECTED))
            } else {
                Ok(())
            }
        });
        Ok(())
    })
    .await
}

#[tokio::test]
async fn opens_in_order_and_closes_in_reverse() {
    let events = Events::default();
    let mut stack = ShutdownStack::default();
    open(&mut stack, &events, "a", false, false).await.unwrap();
    open(&mut stack, &events, "b", false, false).await.unwrap();
    assert_eq!(*events.lock().unwrap(), ["open:a", "open:b"]);
    stack.into_started().shutdown().await;
    assert_eq!(
        *events.lock().unwrap(),
        ["open:a", "open:b", "close:b", "close:a"]
    );
}

#[tokio::test]
async fn each_failure_closes_only_successful_steps_and_preserves_the_error() {
    let names = ["a", "b", "c", "d"];
    for failed in 0..names.len() {
        let events = Events::default();
        let mut stack = ShutdownStack::default();
        for (index, name) in names.iter().copied().enumerate() {
            if let Err(error) = open(&mut stack, &events, name, index == failed, false).await {
                stack.rollback().await;
                assert_eq!(error.code(), INPUT_INVALID);
                assert_eq!(error.params["step"], name);
                break;
            }
        }
        let expected: Vec<_> = names[..=failed]
            .iter()
            .map(|name| format!("open:{name}"))
            .chain(
                names[..failed]
                    .iter()
                    .rev()
                    .map(|name| format!("close:{name}")),
            )
            .collect();
        assert_eq!(*events.lock().unwrap(), expected);
    }
}

#[tokio::test]
async fn failing_step_releases_its_partial_resource_before_returning() {
    let occupied = AtomicBool::new(false);
    let result: Result<(), AppError> = step("partial", async {
        occupied.store(true, Ordering::SeqCst);
        occupied.store(false, Ordering::SeqCst);
        Err(AppError::new(INPUT_INVALID))
    })
    .await;
    ShutdownStack::default().rollback().await;
    assert_eq!(result.unwrap_err().code(), INPUT_INVALID);
    assert!(!occupied.load(Ordering::SeqCst));
}

#[tokio::test]
async fn cleanup_error_does_not_replace_startup_error_or_stop_cleanup() {
    let events = Events::default();
    let mut stack = ShutdownStack::default();
    open(&mut stack, &events, "a", false, false).await.unwrap();
    open(&mut stack, &events, "b", false, true).await.unwrap();
    let error = open(&mut stack, &events, "c", true, false)
        .await
        .unwrap_err();
    stack.rollback().await;
    assert_eq!(error.code(), INPUT_INVALID);
    assert_eq!(error.params["step"], "c");
    assert_eq!(
        *events.lock().unwrap(),
        ["open:a", "open:b", "open:c", "close:b", "close:a"]
    );
}

#[tokio::test]
async fn shutdown_continues_after_close_error() {
    let events = Events::default();
    let mut stack = ShutdownStack::default();
    open(&mut stack, &events, "a", false, false).await.unwrap();
    open(&mut stack, &events, "b", false, true).await.unwrap();
    stack.into_started().shutdown().await;
    assert_eq!(
        *events.lock().unwrap(),
        ["open:a", "open:b", "close:b", "close:a"]
    );
}

#[tokio::test]
async fn shutdown_is_idempotent() {
    let events = Events::default();
    let mut stack = ShutdownStack::default();
    open(&mut stack, &events, "a", false, false).await.unwrap();
    let started = stack.into_started();
    started.shutdown().await;
    started.shutdown().await;
    assert_eq!(*events.lock().unwrap(), ["open:a", "close:a"]);
}

#[tokio::test]
async fn concurrent_shutdowns_both_wait_for_all_closes() {
    let events = Events::default();
    let complete = Arc::new(AtomicBool::new(false));
    let completion = complete.clone();
    let log = events.clone();
    let mut stack = ShutdownStack::default();
    stack.push("slow", move || async move {
        log.lock().unwrap().push("close:slow".into());
        tokio::time::sleep(Duration::from_millis(40)).await;
        completion.store(true, Ordering::SeqCst);
        Ok(())
    });
    open(&mut stack, &events, "last", false, false)
        .await
        .unwrap();
    let started = Arc::new(stack.into_started());
    let barrier = Arc::new(Barrier::new(3));
    let callers: Vec<_> = (0..2)
        .map(|_| {
            let started = started.clone();
            let barrier = barrier.clone();
            let complete = complete.clone();
            tokio::spawn(async move {
                barrier.wait().await;
                started.shutdown().await;
                assert!(complete.load(Ordering::SeqCst));
            })
        })
        .collect();
    barrier.wait().await;
    for caller in callers {
        caller.await.unwrap();
    }
    assert_eq!(
        *events.lock().unwrap(),
        ["open:last", "close:last", "close:slow"]
    );
}

#[tokio::test]
async fn empty_stack_is_valid() {
    let started = ShutdownStack::default().into_started();
    started.shutdown().await;
    started.shutdown().await;
}

#[tokio::test]
async fn steps_return_distinct_concrete_types_without_cleanup() {
    struct Configured(u32);
    struct Ready(String);
    let configured = step("config", async { Ok(Configured(42)) }).await.unwrap();
    let ready = step("ready", async move { Ok(Ready(configured.0.to_string())) })
        .await
        .unwrap();
    ShutdownStack::default().into_started().shutdown().await;
    assert_eq!(ready.0, "42");
}
