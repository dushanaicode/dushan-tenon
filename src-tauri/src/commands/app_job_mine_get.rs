use super::{AppState, JobId, JobSnapshot};
use tenon_framework::{error::IpcError, ipc};
#[tauri::command]
pub async fn app_job_mine_get(
    state: tauri::State<'_, AppState>,
    input: JobId,
) -> Result<JobSnapshot, IpcError> {
    ipc::execute(
        state.inner(),
        stringify!(app_job_mine_get),
        |state| async move {
            tenon_framework::job::get_mine(&state.jobs, state.execution.actor, input.id).await
        },
    )
    .await
}
