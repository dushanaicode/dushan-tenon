use super::{AppState, AuthStatus};
use tenon_framework::{error::IpcError, ipc};

#[tauri::command]
pub async fn account_auth_status(
    state: tauri::State<'_, AppState>,
) -> Result<AuthStatus, IpcError> {
    ipc::execute_public(
        state.inner(),
        stringify!(account_auth_status),
        |state| async move { state.account.auth_status().await },
    )
    .await
}
