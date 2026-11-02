use super::{AppState, DemoSampleId, FilePreview};
use tenon_framework::{error::IpcError, ipc};

#[tauri::command]
pub async fn demo_attachment_preview(
    state: tauri::State<'_, AppState>,
    input: DemoSampleId,
) -> Result<FilePreview, IpcError> {
    ipc::execute(
        state.inner(),
        stringify!(demo_attachment_preview),
        |state| async move { state.demo.attachment_preview(&state.execution, input).await },
    )
    .await
}
