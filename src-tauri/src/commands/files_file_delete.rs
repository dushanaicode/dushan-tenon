use super::{AppState, FileDelete};
use tenon_framework::{error::IpcError, ipc};

#[tauri::command]
pub async fn files_file_delete(
    state: tauri::State<'_, AppState>,
    input: FileDelete,
) -> Result<(), IpcError> {
    ipc::execute(
        state.inner(),
        stringify!(files_file_delete),
        |state| async move { tenon_module_files::file::delete(&state.files, input).await },
    )
    .await
}
