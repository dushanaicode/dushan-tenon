use super::AppState;
use tenon_framework::{error::IpcError, ipc};

#[tauri::command]
pub async fn notify_unread_count(state: tauri::State<'_, AppState>) -> Result<u32, IpcError> {
    ipc::execute(
        state.inner(),
        stringify!(notify_unread_count),
        |state| async move {
            state
                .notify
                .notification_unread_count(&state.execution)
                .await
        },
    )
    .await
}
