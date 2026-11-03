use super::{AppState, WindowEvent};
use tenon_desktop::native::{UNAVAILABLE, window_controls::require_main};
use tenon_framework::{
    error::{AppError, IpcError},
    ipc,
};

#[tauri::command]
pub async fn app_window_watch<R: tauri::Runtime>(
    state: tauri::State<'_, AppState>,
    window: tauri::WebviewWindow<R>,
    on_event: tauri::ipc::Channel<WindowEvent>,
) -> Result<(), IpcError> {
    ipc::execute_control(state.inner(), stringify!(app_window_watch), || {
        require_main(window.label())?;
        state.native.window_controls.watch(
            &state.native.tray,
            Box::new(move |event| on_event.send(event).map_err(|_| AppError::new(UNAVAILABLE))),
            crate::native::window_controls::snapshot(&window)?,
        )
    })
    .await
}
