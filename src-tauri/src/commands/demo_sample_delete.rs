use super::{AppState, DemoSampleVersion};
use tenon_framework::{error::IpcError, ipc};

#[tauri::command]
pub async fn demo_sample_delete(
    state: tauri::State<'_, AppState>,
    input: DemoSampleVersion,
) -> Result<(), IpcError> {
    ipc::execute(
        state.inner(),
        stringify!(demo_sample_delete),
        |state| async move { state.demo.sample_delete(&state.execution, input).await },
    )
    .await
}
