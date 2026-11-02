use super::{AppState, RecoveryRemaining};
use tenon_framework::{error::IpcError, ipc};

#[tauri::command]
pub async fn account_auth_recovery_remaining(
    state: tauri::State<'_, AppState>,
) -> Result<RecoveryRemaining, IpcError> {
    ipc::execute(
        state.inner(),
        stringify!(account_auth_recovery_remaining),
        |state| async move { state.account.recovery_remaining().await },
    )
    .await
}
