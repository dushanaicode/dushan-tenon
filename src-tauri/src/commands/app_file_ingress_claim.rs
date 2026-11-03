use super::AppState;
use super::{FileIngressClaim, FilePicked};
use tenon_framework::{error::IpcError, ipc};

#[tauri::command]
pub async fn app_file_ingress_claim(
    state: tauri::State<'_, AppState>,
    input: FileIngressClaim,
) -> Result<FilePicked, IpcError> {
    ipc::execute_session(state.inner(), stringify!(app_file_ingress_claim), |state| async move {
        crate::file_ingress::claim(&state, state.execution.actor, input).await
    }).await
}
