use super::{AppState, ReclaimReport};
use tenon_framework::{error::IpcError, ipc};

#[tauri::command]
pub async fn files_file_reclaim(
    state: tauri::State<'_, AppState>,
) -> Result<ReclaimReport, IpcError> {
    ipc::execute(
        state.inner(),
        stringify!(files_file_reclaim),
        |state| async move { tenon_module_files::file::reclaim(&state.files).await },
    )
    .await
}
