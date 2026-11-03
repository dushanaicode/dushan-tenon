use super::AppState;
use super::FileIngressId;
use tenon_framework::{error::IpcError, ipc};

#[tauri::command]
pub async fn app_file_recent_open(
    state: tauri::State<'_, AppState>,
    input: FileIngressId,
) -> Result<(), IpcError> {
    ipc::execute_session(state.inner(), stringify!(app_file_recent_open), |state| async move {
        crate::file_ingress::reopen(&state, state.execution.actor, input).await
    }).await
}
