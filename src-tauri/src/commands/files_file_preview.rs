use super::{AppState, FileId, FilePreview};
use tenon_framework::{error::IpcError, ipc};

#[tauri::command]
pub async fn files_file_preview(
    state: tauri::State<'_, AppState>,
    input: FileId,
) -> Result<FilePreview, IpcError> {
    ipc::execute(
        state.inner(),
        stringify!(files_file_preview),
        |state| async move { tenon_module_files::file::preview(&state.files, input).await },
    )
    .await
}
