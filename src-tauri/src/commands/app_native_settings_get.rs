use super::{AppState, NativeSettings};
use tenon_desktop::native::window_controls::require_main;
use tenon_framework::{error::IpcError, ipc};

#[tauri::command]
pub async fn app_native_settings_get<R: tauri::Runtime>(
    state: tauri::State<'_, AppState>,
    window: tauri::WebviewWindow<R>,
) -> Result<NativeSettings, IpcError> {
    ipc::execute(
        state.inner(),
        stringify!(app_native_settings_get),
        |state| async move {
            require_main(window.label())?;
            crate::native::window_state::settings(
                &state,
                state.execution.actor,
                &state.execution.trace_id,
            )
        },
    )
    .await
}
