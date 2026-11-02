use super::{AppState, JobId};
use tenon_framework::{error::IpcError, ipc};

#[tauri::command]
pub async fn devtools_job_retry(
    state: tauri::State<'_, AppState>,
    input: JobId,
) -> Result<(), IpcError> {
    ipc::execute(
        state.inner(),
        stringify!(devtools_job_retry),
        |state| async move { tenon_module_devtools::retry(&state.jobs, input.id).await },
    )
    .await
}
