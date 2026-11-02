use super::{AppState, JobDetail, JobId};
use tenon_framework::{error::IpcError, ipc};

#[tauri::command]
pub async fn devtools_job_get(
    state: tauri::State<'_, AppState>,
    input: JobId,
) -> Result<JobDetail, IpcError> {
    ipc::execute(
        state.inner(),
        stringify!(devtools_job_get),
        |state| async move { tenon_module_devtools::get(&state.jobs, input.id).await },
    )
    .await
}
