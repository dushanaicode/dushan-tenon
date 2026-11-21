//! 任务观察的宿主测试。底座里只有 demo 声明了任务种类，这里排队的任务用 demo.measure；
//! 删 demo 时整个文件一起删，加了自己的任务种类后可以照着重写。

use super::{invoke, with_host};
use crate::{commands, lifecycle::Lifecycle, state::AppState};
use dushan_tenon_lib::contract::StreamCancel;
use serde_json::{Value, json};
use std::{
    sync::{Arc, mpsc},
    time::Duration,
};
use tauri::{Manager, WebviewWindow, ipc::Channel, test::MockRuntime};
use tenon_framework::{
    actor::{Actor, ExecutionContext},
    db::Table,
    id::Id,
    job::{JobEvent, JobId, JobStatus, SubmitJob},
    stream::{StreamEvent, StreamOwner, StreamSink},
    time::Timestamp,
};

const CONFIG: &str = "[ui]\ndeveloper_mode=true\n[notify]\ndesktop=false\n";

#[test]
fn permission_revocation_terminates_administrator_watch() {
    use std::sync::atomic::{AtomicBool, Ordering};
    use tenon_framework::{error::AppError, job::PermissionLookup};
    struct Revocable {
        inner: Arc<dyn PermissionLookup>,
        revoked: Arc<AtomicBool>,
    }
    impl PermissionLookup for Revocable {
        fn has_permission<'a>(
            &'a self,
            actor: Actor,
            key: &'a str,
        ) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<bool, AppError>> + Send + 'a>>
        {
            Box::pin(async move {
                if key == "devtools.job.read" && self.revoked.load(Ordering::SeqCst) {
                    Ok(false)
                } else {
                    self.inner.has_permission(actor, key).await
                }
            })
        }
    }
    let revoked = Arc::new(AtomicBool::new(false));
    with_host(
        "ipc_tests::job_watch::permission_revocation_terminates_administrator_watch",
        CONFIG,
        |state| {
            state.identity.permission_lookup = Arc::new(Revocable {
                inner: state.identity.permission_lookup.clone(),
                revoked: revoked.clone(),
            });
        },
        |window, _| {
            let id = queued_job(window);
            let (_, events) = watch(window, id, false);
            revoked.store(true, Ordering::SeqCst);
            terminal(&events, "failed", Some("app.permission.denied"));
            assert!(
                !tauri::async_runtime::block_on(window.state::<AppState>().jobs.get(id))
                    .unwrap()
                    .cancel_requested
            );
        },
    );
}

fn queued_job(window: &WebviewWindow<MockRuntime>) -> Id {
    let state = window.state::<AppState>();
    tauri::async_runtime::block_on(state.jobs.submit(
        &state.db,
        SubmitJob {
            kind: "demo.measure".into(),
            payload: json!({}),
            priority: 0,
            run_after: Some(
                Timestamp::from_millis(Timestamp::now().as_millis() + 3_600_000).unwrap(),
            ),
            submitted_by: Some(state.account.owner_id().unwrap()),
        },
    ))
    .unwrap()
}

fn watch(window: &WebviewWindow<MockRuntime>, id: Id, mine: bool) -> (Id, mpsc::Receiver<Value>) {
    let (sender, events) = mpsc::channel();
    let channel = Channel::<StreamEvent<JobEvent>>::new(move |body| {
        sender.send(body.deserialize::<Value>().unwrap()).unwrap();
        Ok(())
    });
    // 使用真实命令和 ipc::execute；直接 Channel 回调可观察发送及最后一个 sender 的释放。
    tauri::async_runtime::block_on(async {
        if mine {
            commands::app_job_mine_watch::app_job_mine_watch(
                window.clone(),
                window.state(),
                JobId { id },
                channel,
            )
            .await
        } else {
            commands::devtools_job_watch::devtools_job_watch(
                window.clone(),
                window.state(),
                JobId { id },
                channel,
            )
            .await
        }
    })
    .unwrap();
    let started = events.recv_timeout(Duration::from_secs(5)).unwrap();
    assert_eq!(started["type"], "started");
    assert_eq!(
        events.recv_timeout(Duration::from_secs(5)).unwrap()["type"],
        "progress"
    );
    (
        serde_json::from_value(started["streamId"].clone()).unwrap(),
        events,
    )
}

fn terminal(events: &mpsc::Receiver<Value>, kind: &str, code: Option<&str>) {
    let event = events.recv_timeout(Duration::from_secs(5)).unwrap();
    assert_eq!(event["type"], kind, "{event}");
    if let Some(code) = code {
        assert_eq!(event["code"], code);
    }
    assert!(matches!(
        events.recv_timeout(Duration::from_secs(5)),
        Err(mpsc::RecvTimeoutError::Disconnected)
    ));
}

fn session_change(name: &str, command: &str) {
    with_host(
        name,
        CONFIG,
        |_| {},
        |window, _| {
            invoke(
                window,
                "account_auth_enable_login",
                json!({"input":{"password":"watch-owner-password"}}),
            )
            .unwrap();
            let id = queued_job(window);
            let (_, mine) = watch(window, id, true);
            let (_, admin) = watch(window, id, false);
            invoke(window, command, json!({})).unwrap();
            for events in [&mine, &admin] {
                terminal(events, "failed", Some("account.auth.required"));
            }
            let state = window.state::<AppState>();
            let job = tauri::async_runtime::block_on(state.jobs.get(id)).unwrap();
            assert_eq!(job.status, JobStatus::Queued);
            assert!(!job.cancel_requested);
            // 撤销后即使数据库出现终态，也不能再向已关闭的订阅发送数据。
            tauri::async_runtime::block_on(state.db.update_by_id(
                Table {
                    name: "fw_job",
                    audit: false,
                    soft_delete: false,
                    optimistic_lock: true,
                },
                &ExecutionContext::new(Actor::System, "watch-revoked"),
                id,
                Some(job.row_version),
                [
                    ("status", "failed".into()),
                    ("error_code", "app.input.invalid".into()),
                ],
            ))
            .unwrap();
            for events in [&mine, &admin] {
                assert!(matches!(
                    events.try_recv(),
                    Err(mpsc::TryRecvError::Disconnected)
                ));
            }
        },
    );
}

#[test]
fn session_lock_terminates_both_job_watches() {
    session_change(
        "ipc_tests::job_watch::session_lock_terminates_both_job_watches",
        "account_session_lock",
    );
}

#[test]
fn logout_terminates_both_job_watches() {
    session_change(
        "ipc_tests::job_watch::logout_terminates_both_job_watches",
        "account_auth_logout",
    );
}

#[test]
fn ownership_change_terminates_mine_watch_without_cancelling_job() {
    with_host(
        "ipc_tests::job_watch::ownership_change_terminates_mine_watch_without_cancelling_job",
        CONFIG,
        |_| {},
        |window, _| {
            let id = queued_job(window);
            let (_, events) = watch(window, id, true);
            let state = window.state::<AppState>();
            let job = tauri::async_runtime::block_on(state.jobs.get(id)).unwrap();
            tauri::async_runtime::block_on(state.db.update_by_id(
                Table {
                    name: "fw_job",
                    audit: false,
                    soft_delete: false,
                    optimistic_lock: true,
                },
                &ExecutionContext::new(Actor::System, "watch-owner"),
                id,
                Some(job.row_version),
                [("submitted_by", Id::new().into())],
            ))
            .unwrap();
            terminal(&events, "failed", Some("app.data.not_found"));
            let job = tauri::async_runtime::block_on(state.jobs.get(id)).unwrap();
            assert_eq!(job.status, JobStatus::Queued);
            assert!(!job.cancel_requested);
            assert_eq!(
                invoke(window, "app_job_mine_get", json!({"input":{"id":id}})).unwrap_err()["code"],
                "app.data.not_found"
            );
        },
    );
}

#[test]
fn shutdown_terminates_job_watches_and_rejects_new_subscriptions() {
    with_host(
        "ipc_tests::job_watch::shutdown_terminates_job_watches_and_rejects_new_subscriptions",
        CONFIG,
        |_| {},
        |window, _| {
            let id = queued_job(window);
            let (_, mine) = watch(window, id, true);
            let (_, admin) = watch(window, id, false);
            let lifecycle = window.state::<Arc<Lifecycle>>();
            tauri::async_runtime::block_on(lifecycle.exit.request_exit(lifecycle.shutdown()));
            for events in [&mine, &admin] {
                terminal(events, "cancelled", None);
            }
            for command in ["app_job_mine_watch", "devtools_job_watch"] {
                assert_eq!(
                    invoke(
                        window,
                        command,
                        json!({"input":{"id":id},"channel":"__CHANNEL__:99"})
                    )
                    .unwrap_err()["code"],
                    "app.lifecycle.closing"
                );
            }
        },
    );
}

#[test]
fn stream_cancellation_uses_trusted_actor_and_window_scope() {
    with_host(
        "ipc_tests::job_watch::stream_cancellation_uses_trusted_actor_and_window_scope",
        CONFIG,
        |_| {},
        |window, _| {
            let id = queued_job(window);
            let other =
                tauri::WebviewWindowBuilder::new(window.app_handle(), "other", Default::default())
                    .build()
                    .unwrap();
            let state = window.state::<AppState>();
            for mine in [true, false] {
                let (stream_id, events) = watch(window, id, mine);
                let error =
                    tauri::async_runtime::block_on(commands::app_stream_cancel::app_stream_cancel(
                        other.clone(),
                        other.state(),
                        StreamCancel { stream_id },
                    ))
                    .unwrap_err();
                assert_eq!(error.code, "app.stream.forbidden");
                assert!(
                    invoke(
                        window,
                        "app_stream_cancel",
                        json!({"input":{"streamId":stream_id,"scope":"main"}})
                    )
                    .is_err()
                );
                invoke(
                    window,
                    "app_stream_cancel",
                    json!({"input":{"streamId":stream_id}}),
                )
                .unwrap();
                terminal(&events, "cancelled", None);
            }
            let actor = Actor::User(state.account.owner_id().unwrap());
            for owner in [
                StreamOwner {
                    actor,
                    scope: "other".into(),
                },
                StreamOwner {
                    actor: Actor::User(Id::new()),
                    scope: "main".into(),
                },
            ] {
                let stream = state
                    .streams
                    .open(
                        owner,
                        crate::stream::ChannelSink::<()>(Channel::new(|_| Ok(()))),
                    )
                    .unwrap();
                assert_eq!(invoke(window, "app_stream_cancel", json!({"input":{"streamId":stream.id},"scope":"other","windowLabel":"other"})).unwrap_err()["code"], "app.stream.forbidden");
                assert!(!stream.cancellation.is_cancelled());
            }
            let job = tauri::async_runtime::block_on(state.jobs.get(id)).unwrap();
            assert_eq!(job.status, JobStatus::Queued);
            assert!(!job.cancel_requested);
        },
    );
}

#[test]
fn channel_failures_do_not_expose_transport_details() {
    let sink = crate::stream::ChannelSink::<i32>(Channel::new(|_| {
        Err(tauri::Error::AssetNotFound("sensitive-body".into()))
    }));
    let error = sink
        .send(StreamEvent::Delta { seq: 0, data: 42 })
        .unwrap_err();
    assert_eq!(error.code(), tenon_framework::error::INTERNAL_UNEXPECTED);
    assert!(std::error::Error::source(&error).is_none());
}
