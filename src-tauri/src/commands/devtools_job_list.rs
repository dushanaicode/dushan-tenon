use super::{AppState, JobListInput, JobSummary, Page};
use tenon_framework::{error::IpcError, ipc};

#[tauri::command]
pub async fn devtools_job_list(
    state: tauri::State<'_, AppState>,
    input: JobListInput,
) -> Result<Page<JobSummary>, IpcError> {
    ipc::execute(
        state.inner(),
        stringify!(devtools_job_list),
        |state| async move { tenon_module_devtools::list(&state.jobs, input).await },
    )
    .await
}
