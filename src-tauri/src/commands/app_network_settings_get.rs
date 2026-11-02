use super::*;
use tenon_framework::{error::IpcError, ipc};

#[tauri::command]
pub async fn app_network_settings_get(
    state: tauri::State<'_, AppState>,
) -> Result<NetworkSettings, IpcError> {
    ipc::execute(
        state.inner(),
        stringify!(app_network_settings_get),
        |state| async move {
            let config = crate::ports::read(&state.config)?;
            tenon_desktop::network::settings(&config, &state.network_secrets, || {
                state.require_owner(state.execution.actor)
            })
        },
    )
    .await
}
