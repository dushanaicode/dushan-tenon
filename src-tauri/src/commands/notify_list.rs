use super::{AppState, NotificationItem, NotificationListInput, Page};
use tenon_framework::{error::IpcError, ipc};

#[tauri::command]
pub async fn notify_list(
    state: tauri::State<'_, AppState>,
    input: NotificationListInput,
) -> Result<Page<NotificationItem>, IpcError> {
    ipc::execute(state.inner(), stringify!(notify_list), |state| async move {
        state
            .notify
            .notification_list(&state.execution, input)
            .await
    })
    .await
}
