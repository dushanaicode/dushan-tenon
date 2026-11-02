use super::*;

#[test]
fn entry_classification_and_missing_module_prefix_return_errors_without_dispatch() {
    let _guard = IPC_TEST_LOCK.lock().unwrap();
    let context = test_context(0);
    for command in ["app_control", "missing", "_run", "app_", "unknown_run"] {
        for result in [
            ready(execute(&context, command, |_| async {
                must_not_run("active")
            })),
            ready(execute_session(&context, command, |_| async {
                must_not_run("session")
            })),
            ready(execute_public(&context, command, |_| async {
                must_not_run("public")
            })),
        ] {
            let error = result.unwrap_err();
            assert_eq!(error.code, INTERNAL_UNEXPECTED.as_str());
            assert!(error.params.is_empty());
            assert_eq!(
                Uuid::parse_str(&error.trace_id).unwrap().get_version_num(),
                7
            );
        }
    }
    for command in ["app_test", "app_maintenance", "missing", "_run", "app_"] {
        assert_eq!(
            ready(execute_control(&context, command, || must_not_run(
                "control"
            )))
            .unwrap_err()
            .code,
            INTERNAL_UNEXPECTED.as_str()
        );
    }
    let error = ready(execute_control(&context, "disabled_control", || {
        must_not_run("disabled")
    }))
    .unwrap_err();
    assert_eq!(error.code, MODULE_DISABLED.as_str());
    assert_eq!(
        context.resolved.load(std::sync::atomic::Ordering::Relaxed),
        0
    );
    assert!(context.checked.lock().unwrap().is_empty());
    drop(context.gate.enter().unwrap());
}

#[test]
fn maintenance_rejects_revoked_identity_after_waiting_for_exclusive_admission() {
    run_async_ipc_test(async {
        use std::{sync::atomic::Ordering, time::Duration};
        for level in ["active", "session", "public"] {
            let context = test_context(0);
            let existing = context.gate.enter().unwrap();
            let operation = async {
                match level {
                    "active" => {
                        execute(&context, "app_maintenance", |_| async {
                            must_not_run("active")
                        })
                        .await
                    }
                    "session" => {
                        execute_session(&context, "app_maintenance", |_| async {
                            must_not_run("session")
                        })
                        .await
                    }
                    "public" => {
                        execute_public(&context, "app_maintenance", |_| async {
                            must_not_run("public")
                        })
                        .await
                    }
                    _ => panic!("unexpected level"),
                }
            };
            tokio::pin!(operation);
            assert!(
                tokio::time::timeout(Duration::from_millis(10), &mut operation)
                    .await
                    .is_err()
            );
            let before = context.resolved.load(Ordering::Relaxed);
            assert_eq!(
                before,
                match level {
                    "active" => 1,
                    "session" => 10,
                    _ => 100,
                }
            );
            context.auth_error.store(true, Ordering::Relaxed);
            drop(existing);
            let error = tokio::time::timeout(Duration::from_secs(1), operation)
                .await
                .unwrap()
                .unwrap_err();
            assert_eq!(error.code, crate::error::PERMISSION_DENIED.as_str());
            assert_eq!(context.resolved.load(Ordering::Relaxed), before * 2);
            drop(context.gate.enter().unwrap());
        }
    });
}

#[test]
fn maintenance_checks_permission_before_waiting_and_again_after_identity_changes() {
    run_async_ipc_test(async {
        use std::{sync::atomic::Ordering, time::Duration};
        for revoke_after_wait in [false, true] {
            let context = test_context(0);
            let existing = context.gate.enter().unwrap();
            context
                .permission_denied
                .store(!revoke_after_wait, Ordering::Relaxed);
            let operation = execute(&context, "app_maintenance", |_| async {
                must_not_run("denied")
            });
            tokio::pin!(operation);
            if revoke_after_wait {
                assert!(
                    tokio::time::timeout(Duration::from_millis(10), &mut operation)
                        .await
                        .is_err()
                );
                assert_eq!(context.checked.lock().unwrap().len(), 1);
                context.permission_denied.store(true, Ordering::Relaxed);
            }
            // 首次拒绝时仍持有另一个共享许可，证明没有进入独占等待。
            if !revoke_after_wait {
                let error = tokio::time::timeout(Duration::from_secs(1), &mut operation)
                    .await
                    .unwrap()
                    .unwrap_err();
                assert_eq!(error.code, crate::error::PERMISSION_DENIED.as_str());
                assert_eq!(context.checked.lock().unwrap().len(), 1);
                drop(existing);
            } else {
                drop(existing);
                let error = tokio::time::timeout(Duration::from_secs(1), operation)
                    .await
                    .unwrap()
                    .unwrap_err();
                assert_eq!(error.code, crate::error::PERMISSION_DENIED.as_str());
                assert_eq!(context.checked.lock().unwrap().len(), 2);
            }
            drop(context.gate.enter().unwrap());
        }
    });
}

#[test]
fn maintenance_reauthenticates_without_upgrading_a_shared_lock() {
    run_async_ipc_test(async {
        use std::{sync::atomic::Ordering, time::Duration};
        use tokio::time::timeout;
        let work = Arc::new(Pause::default());
        let context = test_context(42);
        let existing = context.gate.enter().unwrap();
        let work_pause = work.clone();
        let operation = execute(&context, "app_maintenance", |state| async move {
            assert_eq!(state.resolved.load(Ordering::Relaxed), 2);
            assert_eq!(
                state.gate.enter().err().unwrap().code(),
                crate::maintenance::OPERATION_BUSY
            );
            work_pause.wait().await;
            Ok(42)
        });
        tokio::pin!(operation);
        assert!(
            timeout(Duration::from_millis(10), &mut operation)
                .await
                .is_err()
        );
        assert_eq!(context.resolved.load(Ordering::Relaxed), 1);
        drop(existing);
        assert!(
            timeout(Duration::from_millis(10), &mut operation)
                .await
                .is_err()
        );
        assert_eq!(context.resolved.load(Ordering::Relaxed), 2);
        assert_eq!(
            context.gate.enter().err().unwrap().code(),
            crate::maintenance::OPERATION_BUSY
        );
        work.resume.notify_one();
        assert_eq!(
            timeout(Duration::from_secs(2), operation)
                .await
                .unwrap()
                .unwrap(),
            42
        );
        drop(context.gate.enter().unwrap());
    });
}

#[test]
fn control_runs_during_maintenance_and_never_touches_identity() {
    run_async_ipc_test(async {
        use std::{sync::atomic::Ordering, time::Duration};
        use tokio::time::timeout;
        let context = test_context(42);
        let exclusive = context.gate.quiesce().await.unwrap();
        timeout(
            Duration::from_secs(1),
            execute_control(&context, "app_control", || Ok(())),
        )
        .await
        .unwrap()
        .unwrap();
        assert_eq!(context.resolved.load(Ordering::Relaxed), 0);
        drop(exclusive);
        context.gate.close().await;
        let error = execute_control(&context, "app_control", || Ok(()))
            .await
            .unwrap_err();
        assert_eq!(error.code, crate::maintenance::LIFECYCLE_CLOSING.as_str());
        assert_eq!(context.resolved.load(Ordering::Relaxed), 0);
    });
}

#[test]
fn gate_covers_ipc_and_job_callbacks() {
    run_async_ipc_test(async {
        use crate::maintenance::{LIFECYCLE_CLOSING, OPERATION_BUSY};
        use std::{sync::atomic::Ordering, time::Duration};
        use tokio::time::timeout;

        for level in ["active", "session", "public"] {
            let auth = Arc::new(Pause::default());
            let work = Arc::new(Pause::default());
            let mut context = test_context(42);
            context.auth_pause = Some(auth.clone());
            let context = Arc::new(context);
            let worker = context.clone();
            let work_pause = work.clone();
            let operation = tokio::spawn(async move {
                match level {
                    "active" => {
                        execute(worker.as_ref(), "app_test", |_| async {
                            work_pause.wait().await;
                            Ok(())
                        })
                        .await
                    }
                    "session" => {
                        execute_session(worker.as_ref(), "app_test", |_| async {
                            work_pause.wait().await;
                            Ok(())
                        })
                        .await
                    }
                    "public" => {
                        execute_public(worker.as_ref(), "app_test", |_| async {
                            work_pause.wait().await;
                            Ok(())
                        })
                        .await
                    }
                    _ => panic!("unexpected test case"),
                }
            });
            timeout(Duration::from_secs(2), auth.entered.notified())
                .await
                .unwrap();
            let maintenance = context.gate.quiesce();
            tokio::pin!(maintenance);
            assert!(
                timeout(Duration::from_millis(10), &mut maintenance)
                    .await
                    .is_err()
            );
            let resolutions = context.resolved.load(Ordering::Relaxed);
            let rejected = [
                execute(context.as_ref(), "app_read", |_| async {
                    must_not_run("must not execute")
                })
                .await,
                execute_session(context.as_ref(), "app_read", |_| async {
                    must_not_run("must not execute")
                })
                .await,
                execute_public(context.as_ref(), "app_read", |_| async {
                    must_not_run("must not execute")
                })
                .await,
            ];
            for result in rejected {
                assert_eq!(result.unwrap_err().code, OPERATION_BUSY.as_str());
            }
            assert_eq!(context.resolved.load(Ordering::Relaxed), resolutions);
            auth.resume.notify_one();
            timeout(Duration::from_secs(2), work.entered.notified())
                .await
                .unwrap();
            assert!(
                timeout(Duration::from_millis(10), &mut maintenance)
                    .await
                    .is_err()
            );
            work.resume.notify_one();
            operation.await.unwrap().unwrap();
            let exclusive = timeout(Duration::from_secs(2), maintenance)
                .await
                .unwrap()
                .unwrap();
            drop(exclusive);
            context.gate.close().await;
            let error = execute(context.as_ref(), "app_test", |_| async { Ok(()) })
                .await
                .unwrap_err();
            assert_eq!(error.code, LIFECYCLE_CLOSING.as_str());
            assert_eq!(context.resolved.load(Ordering::Relaxed), resolutions);
        }
    });
}
