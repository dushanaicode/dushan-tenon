use super::{AppState, UpdateState};
use tenon_framework::{error::IpcError, ipc};

#[tauri::command]
pub async fn app_update_status(state: tauri::State<'_, AppState>) -> Result<UpdateState, IpcError> {
    ipc::execute(
        state.inner(),
        stringify!(app_update_status),
        |state| async move { state.native.updater.status() },
    )
    .await
}
