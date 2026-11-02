use super::{AppState, FileListInput, FileSummary, Page};
use tenon_framework::{error::IpcError, ipc};

#[tauri::command]
pub async fn files_file_list(
    state: tauri::State<'_, AppState>,
    input: FileListInput,
) -> Result<Page<FileSummary>, IpcError> {
    ipc::execute(
        state.inner(),
        stringify!(files_file_list),
        |state| async move { tenon_module_files::file::list(&state.files, input).await },
    )
    .await
}
