use super::*;
use tenon_framework::ipc::IpcContext;
use tenon_framework::{
    error::{AppError, IpcError},
    ipc,
};
#[tauri::command]
pub async fn app_settings_update(
    state: tauri::State<'_, AppState>,
    input: AppSettingsUpdate,
) -> Result<AppSettings, IpcError> {
    ipc::execute_public(
        state.inner(),
        stringify!(app_settings_update),
        |state| async move {
            if input.developer_mode.is_some() {
                state.actor_resolver().resolve_active().await?;
            }
            let mut config = state
                .config
                .lock()
                .map_err(|_| AppError::new(tenon_framework::error::INTERNAL_UNEXPECTED))?;
            let previous = config.settings();
            let settings = config.update_settings(&state.state_root, &input)?;
            drop(config);
            crate::native::chrome::settings_changed(
                state.native.chrome.as_ref(),
                &previous,
                &settings,
            );
            if input.log_level.is_some() {
                state
                    .log_level
                    .set_level(settings.log_level.value)
                    .map_err(crate::boot::internal)?;
            }
            Ok(settings)
        },
    )
    .await
}
