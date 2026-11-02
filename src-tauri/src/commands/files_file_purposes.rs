use super::{AppState, FilePurposes};
use tenon_framework::{error::IpcError, ipc};

#[tauri::command]
pub async fn files_file_purposes(
    state: tauri::State<'_, AppState>,
) -> Result<FilePurposes, IpcError> {
    ipc::execute(
        state.inner(),
        stringify!(files_file_purposes),
        |state| async move { Ok(tenon_module_files::file::purposes(&state.files)) },
    )
    .await
}
