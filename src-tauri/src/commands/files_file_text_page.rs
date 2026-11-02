use super::{AppState, FileTextPage, FileTextPageInput};
use tenon_framework::{error::IpcError, ipc};

#[tauri::command]
pub async fn files_file_text_page(
    state: tauri::State<'_, AppState>,
    input: FileTextPageInput,
) -> Result<FileTextPage, IpcError> {
    ipc::execute(
        state.inner(),
        stringify!(files_file_text_page),
        |state| async move { tenon_module_files::file::text_page(&state.files, input).await },
    )
    .await
}
