use super::{AppState, WindowCloseDecision};
use tenon_desktop::native::window_controls::require_main;
use tenon_framework::{error::IpcError, ipc};

#[tauri::command]
pub async fn app_window_close_decide<R: tauri::Runtime>(
    state: tauri::State<'_, AppState>,
    window: tauri::WebviewWindow<R>,
    input: WindowCloseDecision,
) -> Result<(), IpcError> {
    ipc::execute_control(state.inner(), stringify!(app_window_close_decide), || {
        require_main(window.label())?;
        state.native.window_controls.decide(
            &state.native.tray,
            &state.config,
            &state.state_root,
            input,
        )
    })
    .await
}
