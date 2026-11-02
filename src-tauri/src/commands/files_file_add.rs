use super::{AppState, FileAddInput, FileSummary};
use tenon_framework::{error::IpcError, ipc};

#[tauri::command]
pub async fn files_file_add(
    state: tauri::State<'_, AppState>,
    input: FileAddInput,
) -> Result<FileSummary, IpcError> {
    ipc::execute(
        state.inner(),
        stringify!(files_file_add),
        |state| async move {
            let selected = state.picked_files.take(
                &input.file_token,
                state.execution.actor,
                tenon_desktop::picked_files::FilePurpose::Store,
                None,
            )?;
            tenon_module_files::file::add(
                &state.files,
                &state.execution,
                &input.purpose,
                &selected.path,
            )
            .await
        },
    )
    .await
}
