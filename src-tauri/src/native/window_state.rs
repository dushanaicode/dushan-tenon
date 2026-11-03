//! 显式 window-state 存储和 D3 原生设置的宿主快照。

use crate::{ports, state::AppState};
use dushan_tenon_lib::contract::{
    NativeSettings, NativeWindowSettings, UpdaterSettings, WINDOW_STATE_INVALID,
    WINDOW_STATE_WRITE_FAILED, WindowRestoreState,
};
use std::{path::Path, sync::Arc};
use tauri_plugin_window_state::{Failure, RestoreState, WindowState};
use tenon_desktop::native::UNAVAILABLE;
use tenon_framework::{
    actor::Actor,
    error::{AppError, IpcError},
};

pub(crate) use dushan_tenon_lib::contract::WINDOW_STATE_WRITE_FAILED as WRITE_FAILED;

pub(crate) fn create(root: &Path, enabled: bool) -> Result<Arc<WindowState>, AppError> {
    let root = root
        .canonicalize()
        .map_err(|_| AppError::new(UNAVAILABLE))?;
    WindowState::new(root.join("window-state.json"), enabled)
        .map_err(|_| AppError::new(WINDOW_STATE_INVALID))
}

pub(crate) fn settings(
    state: &AppState,
    actor: Actor,
    trace: &str,
) -> Result<NativeSettings, AppError> {
    let config = ports::read(&state.config)?.native_settings();
    let status = state.native.window_state.status();
    Ok(NativeSettings {
        can_edit: actor == Actor::User(state.account.owner_id()?),
        updater: UpdaterSettings {
            check_on_start: config.check_on_start,
            configured: state.native.updater.configured(),
        },
        tray: state.native.tray.settings(&state.config, trace)?,
        autostart: state.native.autostart.settings(&state.config, trace)?,
        shortcut: state.native.shortcuts.settings(&state.config, trace)?,
        window: NativeWindowSettings {
            restore_state: config.restore_state,
            state: match status.state {
                RestoreState::FirstRun => WindowRestoreState::FirstRun,
                RestoreState::Restored => WindowRestoreState::Restored,
                RestoreState::Disabled => WindowRestoreState::Disabled,
                RestoreState::Failed => WindowRestoreState::Failed,
            },
            error: status.error.map(|error| IpcError {
                code: match error {
                    Failure::Invalid => WINDOW_STATE_INVALID,
                    Failure::Write => WINDOW_STATE_WRITE_FAILED,
                    Failure::Read | Failure::Window => UNAVAILABLE,
                }
                .as_str()
                .into(),
                params: Default::default(),
                trace_id: trace.into(),
            }),
        },
    })
}
