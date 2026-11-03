use super::AppState;
use tauri::Manager;
use tenon_desktop::native::window_controls::require_main;
use tenon_framework::{error::IpcError, ipc};

#[tauri::command]
pub async fn app_window_close<R: tauri::Runtime>(
    state: tauri::State<'_, AppState>,
    window: tauri::WebviewWindow<R>,
) -> Result<(), IpcError> {
    ipc::execute_control(state.inner(), stringify!(app_window_close), || {
        require_main(window.label())?;
        crate::native::close_requested(window.app_handle())
    })
    .await
}
