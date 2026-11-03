use super::{AppState, OpenKnownTargetInput};
use tenon_desktop::native::window_controls::require_main;
use tenon_framework::{error::IpcError, ipc};

#[tauri::command]
pub async fn app_open_known_target<R: tauri::Runtime>(
    state: tauri::State<'_, AppState>,
    window: tauri::WebviewWindow<R>,
    input: OpenKnownTargetInput,
) -> Result<(), IpcError> {
    ipc::execute(
        state.inner(),
        stringify!(app_open_known_target),
        |state| async move {
            require_main(window.label())?;
            state.native.known_targets.open(input.target)
        },
    )
    .await
}
