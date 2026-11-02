use super::{AppState, DemoSample, DemoSampleCreate};
use tenon_framework::{error::IpcError, ipc};

#[tauri::command]
pub async fn demo_sample_create(
    state: tauri::State<'_, AppState>,
    input: DemoSampleCreate,
) -> Result<DemoSample, IpcError> {
    ipc::execute(
        state.inner(),
        stringify!(demo_sample_create),
        |state| async move { state.demo.sample_create(&state.execution, input).await },
    )
    .await
}
