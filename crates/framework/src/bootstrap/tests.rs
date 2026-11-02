use std::sync::{
    Arc, Mutex,
    atomic::{AtomicBool, Ordering},
};
use std::time::Duration;

use tokio::sync::Barrier;

use super::*;
use crate::error::{INPUT_INVALID, INTERNAL_UNEXPECTED};

type Events = Arc<Mutex<Vec<String>>>;

fn step(name: &'static str, fail_open: bool, fail_close: bool) -> Step<Events> {
    Step::new(
        name,
        move |events: &mut Events| {
            Box::pin(async move {
                events.lock().unwrap().push(format!("open:{name}"));
                if fail_open {
                    Err(AppError::new(INPUT_INVALID).with_param("step", name))
                } else {
                    Ok(())
                }
            })
        },
        move |events| {
            Box::pin(async move {
                events.lock().unwrap().push(format!("close:{name}"));
                if fail_close {
                    Err(AppError::new(INTERNAL_UNEXPECTED))
                } else {
                    Ok(())
                }
            })
        },
    )
}

#[tokio::test]
async fn opens_in_order_and_closes_in_reverse() {
    let events = Events::default();
    let started = Pipeline::new(vec![step("a", false, false), step("b", false, false)])
        .start(events.clone())
        .await
        .unwrap();
    assert_eq!(*events.lock().unwrap(), ["open:a", "open:b"]);
    started.shutdown().await;
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
        let result = Pipeline::new(
            names
                .iter()
                .enumerate()
                .map(|(index, &name)| step(name, index == failed, false))
                .collect(),
        )
        .start(events.clone())
        .await;
        let error = result.err().unwrap();
        assert_eq!(error.code(), INPUT_INVALID);
        assert_eq!(error.params["step"], names[failed]);
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
    let occupied = Arc::new(AtomicBool::new(false));
    let failed = Step::new(
        "partial",
        |occupied: &mut Arc<AtomicBool>| {
            Box::pin(async move {
                occupied.store(true, Ordering::SeqCst);
                // 模拟 open 自己释放已占用的半个资源。
                occupied.store(false, Ordering::SeqCst);
                Err(AppError::new(INPUT_INVALID))
            })
        },
        |_| Box::pin(async { panic!("失败步骤不得进入关闭栈") }),
    );
    let result = Pipeline::new(vec![failed]).start(occupied.clone()).await;
    assert_eq!(result.err().unwrap().code(), INPUT_INVALID);
    assert!(!occupied.load(Ordering::SeqCst));
}

#[tokio::test]
async fn cleanup_error_does_not_replace_startup_error_or_stop_cleanup() {
    let events = Events::default();
    let error = Pipeline::new(vec![
        step("a", false, false),
        step("b", false, true),
        step("c", true, false),
    ])
    .start(events.clone())
    .await
    .err()
    .unwrap();
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
    let started = Pipeline::new(vec![step("a", false, false), step("b", false, true)])
        .start(events.clone())
        .await
        .unwrap();
    started.shutdown().await;
    assert_eq!(
        *events.lock().unwrap(),
        ["open:a", "open:b", "close:b", "close:a"]
    );
}

#[tokio::test]
async fn shutdown_is_idempotent() {
    let events = Events::default();
    let started = Pipeline::new(vec![step("a", false, false), step("b", false, false)])
        .start(events.clone())
        .await
        .unwrap();
    started.shutdown().await;
    started.shutdown().await;
    assert_eq!(
        *events.lock().unwrap(),
        ["open:a", "open:b", "close:b", "close:a"]
    );
}

#[tokio::test]
async fn concurrent_shutdowns_both_wait_for_all_closes() {
    let events = Events::default();
    let complete = Arc::new(AtomicBool::new(false));
    let completion = complete.clone();
    let slow = Step::new(
        "slow",
        |_| Box::pin(async { Ok(()) }),
        move |events: &mut Events| {
            let complete = completion.clone();
            Box::pin(async move {
                events.lock().unwrap().push("close:slow".into());
                tokio::time::sleep(Duration::from_millis(40)).await;
                complete.store(true, Ordering::SeqCst);
                Ok(())
            })
        },
    );
    let started = Arc::new(
        Pipeline::new(vec![slow, step("last", false, false)])
            .start(events.clone())
            .await
            .unwrap(),
    );
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
async fn empty_pipeline_is_valid() {
    let started = Pipeline::new(Vec::new()).start(()).await.unwrap();
    started.shutdown().await;
    started.shutdown().await;
}

#[tokio::test]
async fn open_only_needs_no_cleanup() {
    let events = Events::default();
    let started = Pipeline::new(vec![Step::open_only("open", |events: &mut Events| {
        Box::pin(async move {
            events.lock().unwrap().push("open".into());
            Ok(())
        })
    })])
    .start(events.clone())
    .await
    .unwrap();
    started.shutdown().await;
    assert_eq!(*events.lock().unwrap(), ["open"]);
}
