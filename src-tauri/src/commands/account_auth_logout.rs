use super::AppState;
use tenon_framework::{error::IpcError, ipc};

#[tauri::command]
pub async fn account_auth_logout(state: tauri::State<'_, AppState>) -> Result<(), IpcError> {
    ipc::execute_session(
        state.inner(),
        stringify!(account_auth_logout),
        |state| async move { state.account.logout(&state.execution).await },
    )
    .await
}
