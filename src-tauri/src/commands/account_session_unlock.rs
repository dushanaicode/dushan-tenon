use super::{AppState, PasswordProof};
use tenon_framework::{error::IpcError, ipc};

#[tauri::command]
pub async fn account_session_unlock(
    state: tauri::State<'_, AppState>,
    input: PasswordProof,
) -> Result<(), IpcError> {
    ipc::execute_session(
        state.inner(),
        stringify!(account_session_unlock),
        |state| async move { state.account.unlock(&state.execution, input).await },
    )
    .await
}
