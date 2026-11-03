use super::{AppState, DemoImportInput, JobSubmitted};
use tenon_framework::{error::IpcError, ipc};

#[tauri::command]
pub async fn demo_sample_import(
    state: tauri::State<'_, AppState>,
    input: DemoImportInput,
) -> Result<JobSubmitted, IpcError> {
    ipc::execute(
        state.inner(),
        stringify!(demo_sample_import),
        |state| async move { crate::exchange::import(&state, &state.execution, input).await },
    )
    .await
}
