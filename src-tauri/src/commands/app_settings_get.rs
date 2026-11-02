use tenon_framework::{error::IpcError, ipc};

use super::{AppSettings, AppState};

#[tauri::command]
pub async fn app_settings_get(state: tauri::State<'_, AppState>) -> Result<AppSettings, IpcError> {
    ipc::execute_public(
        state.inner(),
        stringify!(app_settings_get),
        |state| async move { Ok(crate::ports::read(&state.config)?.settings()) },
    )
    .await
}
