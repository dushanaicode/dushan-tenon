use super::*;
use tenon_framework::{
    error::{AppError, IpcError},
    ipc,
};

#[tauri::command]
pub async fn app_network_settings_update(
    state: tauri::State<'_, AppState>,
    input: NetworkSettingsUpdate,
) -> Result<NetworkSettings, IpcError> {
    ipc::execute(
        state.inner(),
        stringify!(app_network_settings_update),
        |state| async move {
            let mut config = state
                .config
                .lock()
                .map_err(|_| AppError::new(tenon_framework::error::INTERNAL_UNEXPECTED))?;
            tenon_desktop::network::update(
                &mut config,
                &state.state_root,
                &state.network_secrets,
                input,
                || state.require_owner(state.execution.actor),
            )
        },
    )
    .await
}
