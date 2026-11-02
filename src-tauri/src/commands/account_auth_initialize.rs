use super::{AppState, PasswordInput, RecoveryCodes};
use tenon_framework::{error::IpcError, ipc};

#[tauri::command]
pub async fn account_auth_initialize(
    state: tauri::State<'_, AppState>,
    input: PasswordInput,
) -> Result<RecoveryCodes, IpcError> {
    ipc::execute_public(
        state.inner(),
        stringify!(account_auth_initialize),
        |state| async move {
            state
                .account
                .initialize(input.password, &state.trace_id)
                .await
        },
    )
    .await
}
