use super::{AppState, JobSubmitted, ScheduleId};
use tenon_framework::{error::IpcError, ipc};

#[tauri::command]
pub async fn devtools_schedule_run_now(
    state: tauri::State<'_, AppState>,
    input: ScheduleId,
) -> Result<JobSubmitted, IpcError> {
    ipc::execute(
        state.inner(),
        stringify!(devtools_schedule_run_now),
        |state| async move {
            tenon_module_devtools::schedule::run_now(&state.jobs, &state.execution, input).await
        },
    )
    .await
}
