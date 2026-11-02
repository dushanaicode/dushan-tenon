use super::{AppState, DemoSample, DemoSampleUpdate};
use tenon_framework::{error::IpcError, ipc};

#[tauri::command]
pub async fn demo_sample_update(
    state: tauri::State<'_, AppState>,
    input: DemoSampleUpdate,
) -> Result<DemoSample, IpcError> {
    ipc::execute(
        state.inner(),
        stringify!(demo_sample_update),
        |state| async move { state.demo.sample_update(&state.execution, input).await },
    )
    .await
}
