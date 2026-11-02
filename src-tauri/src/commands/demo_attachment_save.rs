use super::{AppState, DemoAttachmentSave};
use tenon_framework::{error::IpcError, ipc};

#[tauri::command]
pub async fn demo_attachment_save(
    state: tauri::State<'_, AppState>,
    input: DemoAttachmentSave,
) -> Result<(), IpcError> {
    ipc::execute(
        state.inner(),
        stringify!(demo_attachment_save),
        |state| async move {
            let selected = state.picked_files.take(
                &input.file_token,
                state.execution.actor,
                tenon_desktop::picked_files::FilePurpose::Save,
                None,
            )?;
            state
                .demo
                .attachment_save(
                    &state.execution,
                    super::DemoSampleId { id: input.id },
                    &selected.path,
                )
                .await
        },
    )
    .await
}
