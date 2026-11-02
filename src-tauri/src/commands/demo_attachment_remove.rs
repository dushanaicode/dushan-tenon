use super::{AppState, DemoSample, DemoSampleVersion};
use tenon_framework::{error::IpcError, ipc};

#[tauri::command]
pub async fn demo_attachment_remove(
    state: tauri::State<'_, AppState>,
    input: DemoSampleVersion,
) -> Result<DemoSample, IpcError> {
    ipc::execute(
        state.inner(),
        stringify!(demo_attachment_remove),
        |state| async move { state.demo.attachment_remove(&state.execution, input).await },
    )
    .await
}
