use super::{AppState, PasswordProof, RecoveryCodes};
use tenon_framework::{error::IpcError, ipc};

#[tauri::command]
pub async fn account_auth_recovery_regenerate(
    state: tauri::State<'_, AppState>,
    input: PasswordProof,
) -> Result<RecoveryCodes, IpcError> {
    ipc::execute(
        state.inner(),
        stringify!(account_auth_recovery_regenerate),
        |state| async move {
            state
                .account
                .recovery_regenerate(&state.execution, input)
                .await
        },
    )
    .await
}
