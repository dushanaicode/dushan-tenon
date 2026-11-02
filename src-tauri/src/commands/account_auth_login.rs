use super::{AppState, LoginInput};
use tenon_framework::{error::IpcError, ipc};

#[tauri::command]
pub async fn account_auth_login(
    state: tauri::State<'_, AppState>,
    input: LoginInput,
) -> Result<(), IpcError> {
    ipc::execute_public(
        state.inner(),
        stringify!(account_auth_login),
        |state| async move { state.account.login(input).await },
    )
    .await
}
