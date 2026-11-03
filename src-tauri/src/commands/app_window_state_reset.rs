use super::{AppState, NativeSettings, WINDOW_STATE_WRITE_FAILED};
use tenon_desktop::native::{UNAVAILABLE, window_controls::require_main};
use tenon_framework::{
    error::{AppError, IpcError},
    ipc,
};

#[tauri::command]
pub async fn app_window_state_reset<R: tauri::Runtime>(
    state: tauri::State<'_, AppState>,
    window: tauri::WebviewWindow<R>,
) -> Result<NativeSettings, IpcError> {
    ipc::execute(
        state.inner(),
        stringify!(app_window_state_reset),
        |state| async move {
            require_main(window.label())?;
            state.require_owner(state.execution.actor)?;
            tauri_plugin_window_state::reset_window(
                &window.as_ref().window(),
                &state.native.window_state,
            )
            .map_err(|error| {
                AppError::new(match error {
                    tauri_plugin_window_state::Error::Io(_)
                    | tauri_plugin_window_state::Error::Json(_) => WINDOW_STATE_WRITE_FAILED,
                    _ => UNAVAILABLE,
                })
            })?;
            crate::native::window_state::settings(
                &state,
                state.execution.actor,
                &state.execution.trace_id,
            )
        },
    )
    .await
}
