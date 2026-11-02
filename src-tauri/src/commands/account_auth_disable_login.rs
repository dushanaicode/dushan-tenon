use super::{AppState, PasswordProof};
use tenon_framework::{error::IpcError, ipc};

#[tauri::command]
pub async fn account_auth_disable_login(
    state: tauri::State<'_, AppState>,
    input: PasswordProof,
) -> Result<(), IpcError> {
    ipc::execute(
        state.inner(),
        stringify!(account_auth_disable_login),
        |state| async move { state.account.disable_login(&state.execution, input).await },
    )
    .await
}
