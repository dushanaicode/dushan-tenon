use super::AppState;
use tenon_desktop::native::window_controls::{WindowEditState, require_main};
use tenon_framework::{error::IpcError, ipc};

#[tauri::command]
pub async fn app_window_edit_state<R: tauri::Runtime>(
    state: tauri::State<'_, AppState>,
    window: tauri::WebviewWindow<R>,
    input: WindowEditState,
) -> Result<(), IpcError> {
    ipc::execute_control(state.inner(), stringify!(app_window_edit_state), || {
        require_main(window.label())?;
        state.native.window_controls.edit_state(input)
    })
    .await
}
