use tenon_framework::{error::IpcError, ipc};

use super::{AppState, CurrentUser};

#[tauri::command]
pub async fn account_user_me(state: tauri::State<'_, AppState>) -> Result<CurrentUser, IpcError> {
    ipc::execute(
        state.inner(),
        stringify!(account_user_me),
        |state| async move { state.account.user_me(&state.execution).await },
    )
    .await
}
