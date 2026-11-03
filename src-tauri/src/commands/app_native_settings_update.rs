use super::{AppState, NativeSettings, NativeSettingsChange};
use tenon_desktop::{
    config::SETTINGS_OVERRIDDEN,
    native::{UNAVAILABLE, window_controls::require_main},
};
use tenon_framework::{
    error::{AppError, IpcError},
    ipc,
};

#[tauri::command]
pub async fn app_native_settings_update<R: tauri::Runtime>(
    state: tauri::State<'_, AppState>,
    window: tauri::WebviewWindow<R>,
    input: NativeSettingsChange,
) -> Result<NativeSettings, IpcError> {
    ipc::execute(
        state.inner(),
        stringify!(app_native_settings_update),
        |state| async move {
            require_main(window.label())?;
            state.require_owner(state.execution.actor)?;
            match &input {
                NativeSettingsChange::Tray(input) => {
                    state
                        .native
                        .tray
                        .update(&state.config, &state.state_root, input)?
                }
                NativeSettingsChange::Autostart(input) => state.native.autostart.update(
                    &state.config,
                    &state.state_root,
                    input.enabled,
                )?,
                NativeSettingsChange::Shortcut(input) => state.native.shortcuts.update(
                    &state.config,
                    &state.state_root,
                    &input.binding,
                )?,
                NativeSettingsChange::Updater(input) => {
                    state
                        .native
                        .updater
                        .update_settings(&state.config, &state.state_root, input)?
                }
                NativeSettingsChange::Window(_) => {
                    let mut config = crate::ports::read(&state.config)?;
                    let saved = config
                        .update_native_settings(&state.state_root, &input)
                        .map_err(|error| {
                            if error.code() == SETTINGS_OVERRIDDEN {
                                AppError::new(SETTINGS_OVERRIDDEN)
                                    .with_param("key", "window.restore_state")
                            } else {
                                AppError::new(UNAVAILABLE)
                            }
                        })?;
                    state
                        .native
                        .window_state
                        .set_enabled(saved.restore_state.value);
                }
            }
            crate::native::window_state::settings(
                &state,
                state.execution.actor,
                &state.execution.trace_id,
            )
        },
    )
    .await
}
