use super::AppState;
use super::FileIngressDismiss;
use tenon_framework::{error::IpcError, ipc};

#[tauri::command]
pub async fn app_file_ingress_dismiss(
    state: tauri::State<'_, AppState>,
    input: FileIngressDismiss,
) -> Result<(), IpcError> {
    ipc::execute_session(state.inner(), stringify!(app_file_ingress_dismiss), |state| async move {
        crate::file_ingress::dismiss(&state, state.execution.actor, input).await
    }).await
}
