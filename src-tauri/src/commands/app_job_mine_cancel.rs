use super::{AppState, JobId};
use tenon_framework::{error::IpcError, ipc};
#[tauri::command]
pub async fn app_job_mine_cancel(
    state: tauri::State<'_, AppState>,
    input: JobId,
) -> Result<(), IpcError> {
    ipc::execute(
        state.inner(),
        stringify!(app_job_mine_cancel),
        |state| async move {
            tenon_framework::job::cancel_mine(&state.jobs, state.execution.actor, input.id).await
        },
    )
    .await
}
