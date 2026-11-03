use super::AppState;
use super::FileIngressSnapshot;
use tenon_framework::{error::IpcError, ipc};

#[tauri::command]
pub async fn app_file_ingress_list(
    state: tauri::State<'_, AppState>,
) -> Result<FileIngressSnapshot, IpcError> {
    ipc::execute_session(
        state.inner(),
        stringify!(app_file_ingress_list),
        |state| async move { crate::file_ingress::list(&state, state.execution.actor).await },
    )
    .await
}
