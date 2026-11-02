use super::AppState;
use tenon_framework::{error::IpcError, ipc};

#[tauri::command]
pub async fn account_session_lock(state: tauri::State<'_, AppState>) -> Result<(), IpcError> {
    ipc::execute_session(
        state.inner(),
        stringify!(account_session_lock),
        |state| async move { state.account.lock().await },
    )
    .await
}
