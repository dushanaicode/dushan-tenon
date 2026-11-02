use super::{AppState, RecoverInput, RecoverResult};
use tenon_framework::{error::IpcError, ipc};

#[tauri::command]
pub async fn account_auth_recover(
    state: tauri::State<'_, AppState>,
    input: RecoverInput,
) -> Result<RecoverResult, IpcError> {
    ipc::execute_public(
        state.inner(),
        stringify!(account_auth_recover),
        |state| async move { state.account.recover(input, &state.trace_id).await },
    )
    .await
}
