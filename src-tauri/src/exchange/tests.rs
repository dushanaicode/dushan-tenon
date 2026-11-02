use super::*;
use crate::{
    boot::tests::{Fixture, child},
    state::AppState,
};
use std::{
    path::Path,
    sync::atomic::{AtomicI64, Ordering},
    time::Duration,
};
use tenon_desktop::{config::AppSettingsUpdate, picked_files::FILE_TOKEN_INVALID};
use tenon_framework::{
    actor::ExecutionContext,
    id::Id,
    job::{CancellationToken, SubmitJob},
    time::Timestamp,
};
use tenon_module_demo::{DemoImportMode, DemoSampleCreate, DemoSampleVersion};

async fn handoff(
    files: &PickedFileStore,
    actor: Actor,
    purpose: FilePurpose,
    path: &Path,
) -> String {
    let picked = files.insert(actor, purpose, path.into(), &[]).unwrap();
    let handle = files
        .handoff(&picked.token, actor, purpose, None, |handle| async {
            Ok(handle)
        })
        .await
        .unwrap();
    assert_eq!(
        files
            .take(&picked.token, actor, purpose, None)
            .unwrap_err()
            .code(),
        FILE_TOKEN_INVALID
    );
    handle
}

async fn context(
    state: &AppState,
    handler: &dyn JobHandler,
    actor: Option<Id>,
    payload: serde_json::Value,
) -> JobContext {
    let id = state
        .jobs
        .submit(
            &state.db,
            SubmitJob {
                kind: handler.kind().into(),
                payload,
                priority: 0,
                run_after: None,
                submitted_by: actor,
            },
        )
        .await
        .unwrap();
    state
        .jobs
        .test_context(id, CancellationToken::new())
        .await
        .unwrap()
}

fn export_payload(handle: String) -> serde_json::Value {
    serde_json::to_value(ExchangePayload {
        handle,
        format: ExchangeFormat::Json,
        options: DemoExportOptions {
            keyword: None,
            stage: None,
        },
        language: Language::EnUs,
    })
    .unwrap()
}

#[tokio::test]
async fn real_handlers_round_trip_data_without_persisting_paths() {
    if !child("exchange::tests::real_handlers_round_trip_data_without_persisting_paths") {
        return;
    }
    let f = Fixture::new().await;
    let state = &f.running.state;
    let exclusive = state.gate.quiesce().await.unwrap();
    let owner = state.account.owner_id().unwrap();
    let actor = Actor::User(owner);
    let execution = ExecutionContext::new(actor, "exchange-host-test");
    let sample = state
        .demo
        .sample_create(
            &execution,
            DemoSampleCreate {
                code: "host-item".into(),
                title: "Host test 汉字".into(),
                note: "private-note".into(),
            },
        )
        .await
        .unwrap();
    let handlers = handlers(
        state.account.clone(),
        state.demo.clone(),
        state.picked_files.clone(),
    );
    let bound = state.modules.freeze(handlers.clone()).unwrap();
    assert_eq!(bound.job_handlers().len(), 3);
    for handler in &handlers {
        assert!(handler.local_only());
        assert!(!handler.retry_safe());
        assert_eq!(handler.max_attempts(), 1);
    }
    let path = f.root.path().join("host-export.json");
    let handle = handoff(&state.picked_files, actor, FilePurpose::Export, &path).await;
    let export = &handlers[1];
    let context = context(
        state,
        export.as_ref(),
        Some(owner),
        export_payload(handle.clone()),
    )
    .await;
    let persisted = state
        .jobs
        .get(context.id())
        .await
        .unwrap()
        .payload
        .to_string();
    assert!(!persisted.contains("host-export"));
    assert!(!persisted.contains("private-note"));
    assert!(persisted.contains(&handle));
    // 已提交任务继续使用保存的语言，实时偏好变化不改变执行。
    state
        .config
        .write()
        .unwrap()
        .update_settings(
            f.root.path(),
            &AppSettingsUpdate {
                developer_mode: Some(false),
                language: Some(Language::ZhCn),
                ..Default::default()
            },
        )
        .unwrap();
    assert_eq!(export.run(context).await.unwrap()["rows"], 1);
    assert_eq!(
        state
            .picked_files
            .take_handoff(&handle, actor, FilePurpose::Export, None)
            .unwrap_err()
            .code(),
        FILE_TOKEN_INVALID
    );
    state
        .config
        .write()
        .unwrap()
        .update_settings(
            f.root.path(),
            &AppSettingsUpdate {
                developer_mode: Some(true),
                ..Default::default()
            },
        )
        .unwrap();
    state
        .demo
        .sample_delete(
            &execution,
            DemoSampleVersion {
                id: sample.id,
                row_version: sample.row_version,
            },
        )
        .await
        .unwrap();
    let handle = handoff(&state.picked_files, actor, FilePurpose::Import, &path).await;
    let payload = serde_json::to_value(ExchangePayload {
        handle,
        format: ExchangeFormat::Json,
        options: DemoImportOptions {
            mode: DemoImportMode::Error,
        },
        language: Language::EnUs,
    })
    .unwrap();
    let context = self::context(state, handlers[0].as_ref(), Some(owner), payload).await;
    assert_eq!(handlers[0].run(context).await.unwrap()["created"], 1);
    drop(exclusive);
    f.lifecycle.shutdown().await;
}

#[tokio::test]
async fn permissions_are_rechecked_before_the_handoff_is_consumed() {
    if !child("exchange::tests::permissions_are_rechecked_before_the_handoff_is_consumed") {
        return;
    }
    let f = Fixture::new().await;
    let state = &f.running.state;
    let exclusive = state.gate.quiesce().await.unwrap();
    let owner = Actor::User(state.account.owner_id().unwrap());
    let handlers = handlers(
        state.account.clone(),
        state.demo.clone(),
        state.picked_files.clone(),
    );
    for actor in [Some(Id::new()), None] {
        let path = f.root.path().join("must-not-export.json");
        let handle = handoff(&state.picked_files, owner, FilePurpose::Export, &path).await;
        let context = context(
            state,
            handlers[1].as_ref(),
            actor,
            export_payload(handle.clone()),
        )
        .await;
        assert_eq!(
            handlers[1].run(context).await.unwrap_err().code(),
            PERMISSION_DENIED
        );
        assert_eq!(
            state
                .picked_files
                .take_handoff(&handle, owner, FilePurpose::Export, None)
                .unwrap()
                .path,
            path
        );
        assert!(!path.exists());
    }
    drop(exclusive);
    f.lifecycle.shutdown().await;
}

#[tokio::test]
async fn handler_rejects_expired_wrong_purpose_format_and_restart_handles() {
    if !child("exchange::tests::handler_rejects_expired_wrong_purpose_format_and_restart_handles") {
        return;
    }
    let f = Fixture::new().await;
    let state = &f.running.state;
    let exclusive = state.gate.quiesce().await.unwrap();
    let owner = state.account.owner_id().unwrap();
    let actor = Actor::User(owner);
    let now = Arc::new(AtomicI64::new(1_000_000));
    let clock = now.clone();
    let files = Arc::new(PickedFileStore::new(move || {
        Timestamp::from_millis(clock.load(Ordering::SeqCst)).unwrap()
    }));
    let handlers = handlers(state.account.clone(), state.demo.clone(), files.clone());
    for (case, purpose, extension, expected) in [
        ("expired", FilePurpose::Export, "json", FILE_TOKEN_INVALID),
        ("purpose", FilePurpose::Import, "json", FILE_TOKEN_INVALID),
        (
            "format",
            FilePurpose::Export,
            "csv",
            tenon_framework::exchange::FORMAT_MISMATCH,
        ),
        ("restart", FilePurpose::Export, "json", FILE_TOKEN_INVALID),
    ] {
        let path = f.root.path().join(format!("{case}.{extension}"));
        let handle = handoff(&files, actor, purpose, &path).await;
        if case == "expired" {
            now.fetch_add(600_000, Ordering::SeqCst);
        }
        let payload = export_payload(handle.clone());
        let context = context(state, handlers[1].as_ref(), Some(owner), payload).await;
        let result = if case == "restart" {
            let restarted = super::handlers(
                state.account.clone(),
                state.demo.clone(),
                Arc::new(PickedFileStore::default()),
            );
            restarted[1].run(context).await
        } else {
            handlers[1].run(context).await
        };
        assert_eq!(result.unwrap_err().code(), expected, "{case}");
        assert!(!path.exists());
    }
    drop(exclusive);
    f.lifecycle.shutdown().await;
}

#[tokio::test]
async fn job_runner_executes_the_registered_host_handler() {
    if !child("exchange::tests::job_runner_executes_the_registered_host_handler") {
        return;
    }
    let f = Fixture::new().await;
    let state = &f.running.state;
    let owner = state.account.owner_id().unwrap();
    let path = f.root.path().join("runner-export.json");
    let picked = state
        .picked_files
        .insert(Actor::User(owner), FilePurpose::Export, path.clone(), &[])
        .unwrap();
    let id = state
        .picked_files
        .handoff(
            &picked.token,
            Actor::User(owner),
            FilePurpose::Export,
            Some(ExchangeFormat::Json),
            |handle| async move {
                state
                    .jobs
                    .submit(
                        &state.db,
                        SubmitJob {
                            kind: "demo.sample_export".into(),
                            payload: export_payload(handle),
                            priority: 0,
                            run_after: None,
                            submitted_by: Some(owner),
                        },
                    )
                    .await
            },
        )
        .await
        .unwrap();
    let done = tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            let job = state.jobs.get(id).await.unwrap();
            if job.status.is_terminal() {
                break job;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .unwrap();
    assert_eq!(done.status, tenon_framework::job::JobStatus::Succeeded);
    assert!(path.is_file());
    assert!(!done.payload.to_string().contains("runner-export"));
    f.lifecycle.shutdown().await;
}
