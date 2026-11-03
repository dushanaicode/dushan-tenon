//! 数据命令的主窗口/所有者守卫、配置锁和模块恢复校验。

use std::sync::Arc;
use tauri::{Manager, Runtime};
use tenon_desktop::{data::*, picked_files::FilePurpose};
use tenon_framework::{
    backup,
    cache::CacheProvider,
    error::AppError,
    stream::{Stream, StreamOwner},
};

use crate::{boot::internal, modules, ports, state::AppState};

pub(crate) fn require_owner(state: &AppState, owner: &StreamOwner) -> Result<(), AppError> {
    if owner.scope != "main" {
        return Err(AppError::new(dushan_tenon_lib::contract::OWNER_REQUIRED));
    }
    state.require_owner(owner.actor)
}

pub(crate) fn observer(stream: Arc<Stream<OperationProgress>>) -> ProgressObserver {
    Arc::new(move |progress| {
        let _ = stream.delta(progress);
    })
}

pub(crate) fn finish<T>(stream: &Stream<OperationProgress>, result: &Result<T, AppError>) {
    match result {
        Ok(_) => {
            let _ = stream.succeeded(None);
        }
        Err(error) => {
            let _ = stream.failed(error.code().as_str().into(), Default::default());
        }
    }
}

pub(crate) async fn export<R: Runtime>(
    app: tauri::AppHandle<R>,
    owner: StreamOwner,
    token: String,
    progress: ProgressObserver,
) -> Result<FileArtifact, AppError> {
    tokio::task::spawn_blocking(move || {
        let state = app.state::<AppState>();
        require_owner(&state, &owner)?;
        let config = ports::read(&state.config)?;
        if config.cache().provider() != CacheProvider::Local {
            return Err(AppError::new(backup::UNSUPPORTED_CACHE));
        }
        let selected =
            state
                .picked_files
                .take(&token, owner.actor, FilePurpose::BackupExport, None)?;
        tauri::async_runtime::block_on(state.data.export(
            ExportInput {
                destination: selected.path,
                files: state.files.clone(),
                product_id: app.config().identifier.clone(),
                migrations: modules::migrations(),
            },
            progress,
        ))
    })
    .await
    .map_err(internal)?
}

pub(crate) async fn prepare_restore<R: Runtime>(
    app: tauri::AppHandle<R>,
    owner: StreamOwner,
    token: String,
    progress: ProgressObserver,
) -> Result<RestorePlan, AppError> {
    tokio::task::spawn_blocking(move || {
        let state = app.state::<AppState>();
        require_owner(&state, &owner)?;
        let config = ports::read(&state.config)?;
        let selected =
            state
                .picked_files
                .take(&token, owner.actor, FilePurpose::BackupRestore, None)?;
        tauri::async_runtime::block_on(state.data.prepare_restore(
            RestoreTarget {
                owner,
                config: &config,
                instance: state.instance,
            },
            RestoreInput {
                selected: selected.path,
                product_id: app.config().identifier.clone(),
                migrations: modules::migrations(),
            },
            progress,
            |config| {
                modules::registry(
                    state.account.clone(),
                    state.notify.clone(),
                    state.demo.clone(),
                    &config
                        .modules()
                        .iter()
                        .map(|(id, item)| (id.clone(), item.enabled))
                        .collect(),
                )
                .map(|_| ())
                .map_err(|_| AppError::new(backup::INVALID_ARCHIVE))
            },
            async |db| {
                tenon_module_account::AccountService::check_restored_password_hashes(db).await
            },
        ))
    })
    .await
    .map_err(internal)?
}

pub(crate) async fn commit_restore<R: Runtime>(
    app: tauri::AppHandle<R>,
    owner: StreamOwner,
    id: String,
) -> Result<RestoreAccepted, AppError> {
    tokio::task::spawn_blocking(move || {
        let state = app.state::<AppState>();
        require_owner(&state, &owner)?;
        let config = ports::read(&state.config)?;
        tauri::async_runtime::block_on(state.data.commit_restore(
            RestoreTarget {
                owner,
                config: &config,
                instance: state.instance,
            },
            &id,
            || state.gate.close_admission(),
        ))
    })
    .await
    .map_err(internal)?
}
