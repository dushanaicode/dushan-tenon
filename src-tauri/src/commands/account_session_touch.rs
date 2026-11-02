use super::AppState;
use tenon_framework::{error::IpcError, ipc};

#[tauri::command]
pub async fn account_session_touch(state: tauri::State<'_, AppState>) -> Result<(), IpcError> {
    ipc::execute_session(
        state.inner(),
        stringify!(account_session_touch),
        |state| async move { state.account.touch().await },
    )
    .await
}
