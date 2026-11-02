use super::{AppState, DemoMeasureInput, JobSubmitted};
use tenon_framework::{error::IpcError, ipc};

#[tauri::command]
pub async fn demo_measure_start(
    state: tauri::State<'_, AppState>,
    input: DemoMeasureInput,
) -> Result<JobSubmitted, IpcError> {
    ipc::execute(
        state.inner(),
        stringify!(demo_measure_start),
        |state| async move {
            state
                .demo
                .measure_start(&state.jobs, &state.execution, input)
                .await
        },
    )
    .await
}
