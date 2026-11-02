use super::{AppState, NotifyTestResult};
use tenon_framework::{error::IpcError, ipc};

#[tauri::command]
pub async fn notify_test_send(
    state: tauri::State<'_, AppState>,
) -> Result<NotifyTestResult, IpcError> {
    ipc::execute(
        state.inner(),
        stringify!(notify_test_send),
        |state| async move { state.notify.notification_test_send(&state.execution).await },
    )
    .await
}
