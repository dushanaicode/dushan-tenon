use super::AppState;
use tenon_framework::{error::IpcError, ipc};

#[tauri::command]
pub async fn notify_mark_all_read(state: tauri::State<'_, AppState>) -> Result<(), IpcError> {
    ipc::execute(
        state.inner(),
        stringify!(notify_mark_all_read),
        |state| async move {
            state
                .notify
                .notification_mark_all_read(&state.execution)
                .await
        },
    )
    .await
}
