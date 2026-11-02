use super::{AppState, DemoSample, DemoSampleId};
use tenon_framework::{error::IpcError, ipc};

#[tauri::command]
pub async fn demo_sample_get(
    state: tauri::State<'_, AppState>,
    input: DemoSampleId,
) -> Result<DemoSample, IpcError> {
    ipc::execute(
        state.inner(),
        stringify!(demo_sample_get),
        |state| async move { state.demo.sample_get(&state.execution, input).await },
    )
    .await
}
