use super::AppState;
use tenon_desktop::native::window_controls::{WindowEditDecision, require_main};
use tenon_framework::{error::IpcError, ipc};

#[tauri::command]
pub async fn app_window_edit_decide<R: tauri::Runtime>(
    state: tauri::State<'_, AppState>,
    window: tauri::WebviewWindow<R>,
    input: WindowEditDecision,
) -> Result<(), IpcError> {
    ipc::execute_control(state.inner(), stringify!(app_window_edit_decide), || {
        require_main(window.label())?;
        state
            .native
            .window_controls
            .edit_decide(&state.native.tray, input)
    })
    .await
}
