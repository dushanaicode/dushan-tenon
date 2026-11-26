//! 只收集安全事实；探测只由 about 主动触发，导出不访问远端。

use tauri::{Manager, Runtime};
use tenon_desktop::{
    diagnostics::{self, CacheStatus, DiagnosticModule, DiagnosticSnapshot},
    picked_files::FilePurpose,
};
use tenon_framework::{error::AppError, stream::StreamOwner};

use crate::{boot::internal, state::AppState};

pub(crate) fn snapshot(state: &AppState) -> Result<DiagnosticSnapshot, AppError> {
    let config = crate::ports::read(&state.config)?;
    let probe = state
        .diagnostics_probe
        .lock()
        .map_err(|_| AppError::new(tenon_framework::error::INTERNAL_UNEXPECTED))?;
    Ok(DiagnosticSnapshot {
        version: env!("CARGO_PKG_VERSION").into(),
        database_kind: config.database().kind(),
        applied_migrations: state.migrations.applied.len(),
        cache_provider: state.cache.provider(),
        cache_status: probe.as_ref().map(|probe| match probe {
            CacheStatus::Connected => CacheStatus::Connected,
            CacheStatus::Error { code } => CacheStatus::Error { code: *code },
        }),
        language: config.language(),
        theme: config.settings().theme.value,
        theme_style: config.settings().theme_style.value,
        modules: state
            .modules
            .list(&state.migrations.applied)
            .into_iter()
            .map(|module| DiagnosticModule {
                id: module.id,
                version: module.version,
                enabled: module.enabled,
                core: module.core,
            })
            .collect(),
    })
}

pub(crate) async fn export<R: Runtime>(
    app: tauri::AppHandle<R>,
    owner: StreamOwner,
    token: String,
) -> Result<tenon_desktop::data::FileArtifact, AppError> {
    tokio::task::spawn_blocking(move || {
        let state = app.state::<AppState>();
        crate::data::require_owner(&state, &owner)?;
        let snapshot = snapshot(&state)?;
        // 未探测时不消费选择令牌；页面刷新事实后可重试同一导出。
        if snapshot.cache_status.is_none() {
            return Err(AppError::new(diagnostics::NEEDS_PROBE));
        }
        let file =
            state
                .picked_files
                .take(&token, owner.actor, FilePurpose::DiagnosticsExport, None)?;
        diagnostics::export(
            &snapshot,
            &state.state_root,
            &state.state_root.join("Temp/diagnostics"),
            &file.path,
        )
    })
    .await
    .map_err(internal)?
}
