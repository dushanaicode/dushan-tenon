use super::{AppState, DemoAttachmentAdd, DemoSample};
use tenon_framework::{error::IpcError, ipc};

#[tauri::command]
pub async fn demo_attachment_add(
    state: tauri::State<'_, AppState>,
    input: DemoAttachmentAdd,
) -> Result<DemoSample, IpcError> {
    ipc::execute(
        state.inner(),
        stringify!(demo_attachment_add),
        |state| async move {
            let selected = state.picked_files.take(
                &input.file_token,
                state.execution.actor,
                tenon_desktop::picked_files::FilePurpose::Store,
                None,
            )?;
            state
                .demo
                .attachment_add(
                    &state.execution,
                    super::DemoSampleVersion {
                        id: input.id,
                        row_version: input.row_version,
                    },
                    &selected.path,
                )
                .await
        },
    )
    .await
}
