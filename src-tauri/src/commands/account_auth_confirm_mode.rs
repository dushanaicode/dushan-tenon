use super::{AppState, PasswordProof};
use tenon_framework::{error::IpcError, ipc};

#[tauri::command]
pub async fn account_auth_confirm_mode(
    state: tauri::State<'_, AppState>,
    input: PasswordProof,
) -> Result<(), IpcError> {
    ipc::execute_public(
        state.inner(),
        stringify!(account_auth_confirm_mode),
        |state| async move { state.account.confirm_mode(input, &state.trace_id).await },
    )
    .await
}
