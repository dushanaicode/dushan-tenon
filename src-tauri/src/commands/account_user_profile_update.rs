use super::{AppState, UserProfileUpdate};
use tenon_framework::{error::IpcError, ipc};

#[tauri::command]
pub async fn account_user_profile_update(
    state: tauri::State<'_, AppState>,
    input: UserProfileUpdate,
) -> Result<(), IpcError> {
    ipc::execute(
        state.inner(),
        stringify!(account_user_profile_update),
        |state| async move {
            state
                .account
                .user_profile_update(&state.execution, input)
                .await
        },
    )
    .await
}
