use super::{AppState, PasswordInput, RecoveryCodes};
use tenon_framework::{error::IpcError, ipc};

#[tauri::command]
pub async fn account_auth_enable_login(
    state: tauri::State<'_, AppState>,
    input: PasswordInput,
) -> Result<RecoveryCodes, IpcError> {
    ipc::execute(
        state.inner(),
        stringify!(account_auth_enable_login),
        |state| async move {
            state
                .account
                .enable_login(&state.execution, input.password)
                .await
        },
    )
    .await
}
