use super::AppState;
use tenon_desktop::native::{UNAVAILABLE, window_controls::require_main};
use tenon_framework::{
    error::{AppError, IpcError},
    ipc,
};

#[tauri::command]
pub async fn app_window_start_dragging<R: tauri::Runtime>(
    state: tauri::State<'_, AppState>,
    window: tauri::WebviewWindow<R>,
) -> Result<(), IpcError> {
    ipc::execute_control(state.inner(), stringify!(app_window_start_dragging), || {
        require_main(window.label())?;
        window
            .start_dragging()
            .map_err(|_| AppError::new(UNAVAILABLE))
    })
    .await
}
