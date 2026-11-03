use super::{AppState, FilePickInput, FilePicked};
use tenon_framework::{error::IpcError, ipc};

#[tauri::command]
pub async fn app_file_pick<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    state: tauri::State<'_, AppState>,
    input: FilePickInput,
) -> Result<Option<FilePicked>, IpcError> {
    ipc::execute_session(
        state.inner(),
        stringify!(app_file_pick),
        |state| async move {
            crate::picked_files::pick(&app, &state.picked_files, state.execution.actor, input).await
        },
    )
    .await
}
