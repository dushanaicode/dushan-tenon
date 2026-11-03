//! 系统输入和 URI 的适配；预算、路径验证、最近记录与 claim 均在 desktop。

use std::path::{Path, PathBuf};
use tauri::{Manager, Runtime};
use tenon_desktop::{file_ingress::*, picked_files::FilePicked};
use tenon_framework::{
    actor::Actor,
    error::{AppError, PERMISSION_DENIED},
};

use crate::{lifecycle::Lifecycle, state::AppState};

pub(crate) fn enqueue_uri(
    ingress: &FileIngress,
    raw: &str,
    scheme: &str,
    source_root: Option<PathBuf>,
) -> Result<(), AppError> {
    if raw.len() > 1024 || raw.contains('%') || raw.contains("..") || raw.contains('\\') {
        return Err(AppError::new(INVALID));
    }
    let url = tauri::Url::parse(raw).map_err(|_| AppError::new(INVALID))?;
    if url.scheme() != scheme
        || url.host_str() != Some("open")
        || !url.username().is_empty()
        || url.password().is_some()
        || url.port().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err(AppError::new(INVALID));
    }
    ingress.enqueue_route(url.path(), source_root)
}

pub(crate) fn enqueue_arguments<R: Runtime>(
    app: &tauri::AppHandle<R>,
    lifecycle: &Lifecycle,
    inputs: &[String],
    cwd: &Path,
    source_root: Option<PathBuf>,
) {
    if lifecycle.gate.is_closing() || inputs.is_empty() {
        return;
    }
    let ingress = &lifecycle.file_ingress;
    let mut paths = Vec::new();
    let mut rejected = None;
    for value in inputs {
        if value.contains("://") {
            let result = match tauri::Url::parse(value) {
                Ok(url) if url.scheme() == "file" => url
                    .to_file_path()
                    .map(|path| paths.push(path))
                    .map_err(|_| AppError::new(INVALID)),
                _ => enqueue_uri(
                    ingress,
                    value,
                    &app.config().identifier,
                    source_root.clone(),
                ),
            };
            if let Err(error) = result {
                rejected = Some(error);
            }
        } else {
            let path = PathBuf::from(value);
            paths.push(if path.is_absolute() {
                path
            } else {
                cwd.join(path)
            });
        }
    }
    if !paths.is_empty()
        && let Err(error) = ingress.enqueue_paths(&paths, source_root)
    {
        rejected = Some(error);
    }
    if let Some(error) = rejected
        && let Err(error) = ingress.report(&error)
    {
        tracing::warn!(code = %error.code(), "文件接入错误未记录");
    }
    changed(app);
}

pub(crate) fn changed<R: Runtime>(app: &tauri::AppHandle<R>) {
    if let Some(state) = app.try_state::<AppState>()
        && let Err(error) = state.native.window_controls.files_changed()
    {
        tracing::warn!(code = %error.code(), "文件接入通知失败");
    }
}

pub(crate) async fn list(state: &AppState, actor: Actor) -> Result<FileIngressSnapshot, AppError> {
    let Actor::User(owner) = actor else {
        return Err(AppError::new(PERMISSION_DENIED));
    };
    state
        .account
        .with_active_user(owner, || state.file_ingress.list(&state.state_root, owner))
        .await?
        .ok_or_else(|| AppError::new(PERMISSION_DENIED))
}

pub(crate) async fn claim(
    state: &AppState,
    actor: Actor,
    input: FileIngressClaim,
) -> Result<FilePicked, AppError> {
    let Actor::User(owner) = actor else {
        return Err(AppError::new(PERMISSION_DENIED));
    };
    state
        .account
        .with_active_user(owner, || {
            state
                .file_ingress
                .claim(&state.state_root, owner, &state.picked_files, input)
        })
        .await?
        .ok_or_else(|| AppError::new(PERMISSION_DENIED))
}

pub(crate) async fn dismiss(
    state: &AppState,
    actor: Actor,
    input: FileIngressDismiss,
) -> Result<(), AppError> {
    let Actor::User(owner) = actor else {
        return Err(AppError::new(PERMISSION_DENIED));
    };
    state
        .account
        .with_active_user(owner, || {
            state.file_ingress.dismiss(&state.state_root, owner, input)
        })
        .await?
        .ok_or_else(|| AppError::new(PERMISSION_DENIED))
}

pub(crate) async fn reopen(
    state: &AppState,
    actor: Actor,
    input: FileIngressId,
) -> Result<(), AppError> {
    let Actor::User(owner) = actor else {
        return Err(AppError::new(PERMISSION_DENIED));
    };
    state
        .account
        .with_active_user(owner, || {
            state.file_ingress.reopen(&state.state_root, owner, input)
        })
        .await?
        .ok_or_else(|| AppError::new(PERMISSION_DENIED))
}

#[cfg(test)]
mod tests;
