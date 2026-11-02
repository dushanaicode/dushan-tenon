use super::{AppState, NotificationReadInput};
use tenon_framework::{error::IpcError, ipc};

#[tauri::command]
pub async fn notify_mark_read(
    state: tauri::State<'_, AppState>,
    input: NotificationReadInput,
) -> Result<(), IpcError> {
    ipc::execute(
        state.inner(),
        stringify!(notify_mark_read),
        |state| async move {
            state
                .notify
                .notification_mark_read(&state.execution, input)
                .await
        },
    )
    .await
}
