use super::{AppState, UserPasswordChange};
use tenon_framework::{error::IpcError, ipc};

#[tauri::command]
pub async fn account_user_password_change(
    state: tauri::State<'_, AppState>,
    input: UserPasswordChange,
) -> Result<(), IpcError> {
    ipc::execute(
        state.inner(),
        stringify!(account_user_password_change),
        |state| async move {
            state
                .account
                .user_password_change(&state.execution, input)
                .await
        },
    )
    .await
}
