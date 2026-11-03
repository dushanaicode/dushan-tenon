use super::*;
use std::time::Duration;

#[tokio::test]
async fn failure_waits_for_dialog_and_honors_retry_or_exit_after_shared_shutdown() {
    for retry in [false, true] {
        let app = crate::boot::tests::app();
        let lifecycle = Arc::new(Lifecycle::new());
        let mut reply = None;
        let error = AppError::new(INTERNAL_UNEXPECTED)
            .with_source(std::io::Error::other("private-path-sentinel"));
        present_with(
            app.handle(),
            &lifecycle,
            &error,
            vec![
                "--state-root".into(),
                "explicit-state".into(),
                "--set".into(),
                "ui.theme=dark".into(),
            ],
            |summary, fatal, callback| {
                assert!(!fatal);
                assert!(!summary.contains("sentinel"));
                reply = Some(callback);
            },
        );
        assert!(lifecycle.recovery_ui.waiting());
        assert!(lifecycle.gate.is_closing());
        crate::application::request_exit(app.handle(), &lifecycle);
        assert!(!lifecycle.exit.is_finished());
        reply.unwrap()(retry);
        tokio::time::timeout(Duration::from_secs(2), async {
            while !lifecycle.exit.is_finished() {
                tokio::task::yield_now().await;
            }
        })
        .await
        .unwrap();
        assert!(!lifecycle.recovery_ui.waiting());
        let mut calls = 0;
        lifecycle
            .recovery_ui
            .restart_with(|args| {
                assert!(retry, "exit must not restart");
                assert!(lifecycle.exit.is_finished());
                assert_eq!(
                    args,
                    vec![
                        OsString::from("--state-root"),
                        "explicit-state".into(),
                        "--set".into(),
                        "ui.theme=dark".into()
                    ]
                );
                calls += 1;
                Ok(())
            })
            .unwrap();
        lifecycle
            .recovery_ui
            .restart_with(|_| panic!("duplicate restart"))
            .unwrap();
        assert_eq!(calls, usize::from(retry));
    }
}

#[tokio::test]
async fn restore_failure_cannot_choose_retry() {
    let app = crate::boot::tests::app();
    let lifecycle = Arc::new(Lifecycle::new());
    present_with(
        app.handle(),
        &lifecycle,
        &AppError::new(tenon_framework::backup::ROLLBACK_FAILED),
        vec![],
        |summary, fatal, reply| {
            assert!(fatal);
            assert!(summary.contains("不要删除数据库或创建空库"));
            reply(true);
        },
    );
    tokio::time::timeout(Duration::from_secs(2), async {
        while !lifecycle.exit.is_finished() {
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    lifecycle
        .recovery_ui
        .restart_with(|_| panic!("fatal restore cannot retry"))
        .unwrap();
    assert_eq!(lifecycle.exit_code(), 1);
}

#[test]
fn restore_restart_uses_only_validated_root_id_and_overrides() {
    let root = std::path::Path::new("explicit-state");
    let id = "0123456789abcdef0123456789abcdef";
    let args =
        crate::restore::restart_args(root, true, &["ui.developer_mode=true".into()], id).unwrap();
    assert_eq!(
        args,
        [
            "--state-root",
            "explicit-state",
            "--restore-prepared",
            id,
            "--set",
            "ui.developer_mode=true"
        ]
        .map(OsString::from)
    );
    assert_eq!(
        crate::restore::restart_args(root, false, &[], id).unwrap(),
        ["--restore-prepared", id].map(OsString::from)
    );
    assert!(crate::restore::restart_args(root, true, &[], "../other").is_err());
    let ui = RecoveryUi::default();
    ui.schedule_restart(args).unwrap();
    assert!(
        ui.restart_with(|_| Err(std::io::Error::other("spawn denied")))
            .is_err()
    );
}
