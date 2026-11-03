use super::{AppState, DemoExportInput, JobSubmitted};
use tenon_framework::{error::IpcError, ipc};

#[tauri::command]
pub async fn demo_sample_export(
    state: tauri::State<'_, AppState>,
    input: DemoExportInput,
) -> Result<JobSubmitted, IpcError> {
    ipc::execute(
        state.inner(),
        stringify!(demo_sample_export),
        |state| async move { crate::exchange::export(&state, &state.execution, input).await },
    )
    .await
}
