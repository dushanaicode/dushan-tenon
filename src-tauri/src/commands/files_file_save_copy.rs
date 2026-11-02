use super::{AppState, FileSaveInput};
use tenon_framework::{error::IpcError, ipc};

#[tauri::command]
pub async fn files_file_save_copy(
    state: tauri::State<'_, AppState>,
    input: FileSaveInput,
) -> Result<(), IpcError> {
    ipc::execute(
        state.inner(),
        stringify!(files_file_save_copy),
        |state| async move {
            let selected = state.picked_files.take(
                &input.file_token,
                state.execution.actor,
                tenon_desktop::picked_files::FilePurpose::Save,
                None,
            )?;
            tenon_module_files::file::save_copy(&state.files, input.id, &selected.path).await
        },
    )
    .await
}
