use super::*;
use tenon_framework::{error::IpcError, ipc};

#[tauri::command]
pub async fn app_about_get(state: tauri::State<'_, AppState>) -> Result<AppAbout, IpcError> {
    ipc::execute(
        state.inner(),
        stringify!(app_about_get),
        |state| async move {
            let cache_status = match state.cache.ping().await {
                Ok(()) => CacheStatus::Connected,
                Err(error) => CacheStatus::Error {
                    code: error.code().to_string(),
                },
            };
            let config = crate::ports::read(&state.config)?;
            Ok(AppAbout {
                version: env!("CARGO_PKG_VERSION").into(),
                state_root: state.state_root.display().to_string(),
                config_file: state.state_root.join("config.toml").display().to_string(),
                config_file_exists: config.file_exists(),
                log_directory: state.state_root.join("logs").display().to_string(),
                database_kind: config.database().kind(),
                database_location: tenon_desktop::database::location(
                    &state.state_root,
                    config.database(),
                ),
                applied_migrations: state.migrations.applied.len() as u32,
                cache_provider: state.cache.provider(),
                cache_location: config.cache().location(),
                cache_status,
            })
        },
    )
    .await
}
