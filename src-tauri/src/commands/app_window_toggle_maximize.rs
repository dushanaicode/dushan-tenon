use super::AppState;
use tenon_desktop::native::{UNAVAILABLE, window_controls::require_main};
use tenon_framework::{
    error::{AppError, IpcError},
    ipc,
};

#[tauri::command]
pub async fn app_window_toggle_maximize<R: tauri::Runtime>(
    state: tauri::State<'_, AppState>,
    window: tauri::WebviewWindow<R>,
) -> Result<(), IpcError> {
    ipc::execute_control(
        state.inner(),
        stringify!(app_window_toggle_maximize),
        || {
            require_main(window.label())?;
            if window
                .is_maximized()
                .map_err(|_| AppError::new(UNAVAILABLE))?
            {
                window.unmaximize()
            } else {
                window.maximize()
            }
            .map_err(|_| AppError::new(UNAVAILABLE))
        },
    )
    .await
}
