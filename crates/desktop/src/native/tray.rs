//! 托盘事务与关闭动作；关闭事件 try_lock，隐藏与释放前保证窗口可找回。

use std::{
    path::Path,
    sync::{Arc, Mutex, TryLockError},
};

use serde::Serialize;
use tenon_framework::{
    error::{AppError, ErrorCode, INPUT_INVALID, IpcError},
    maintenance::LIFECYCLE_CLOSING,
};
use ts_rs::TS;

use super::{NativeFailure, UNAVAILABLE, check_source};
use crate::config::{
    CloseAction as WindowCloseAction, LoadedConfig, NativeSettingsChange, Setting,
    TraySettingsChange,
};

pub const UNSUPPORTED: ErrorCode = ErrorCode::new("app.native.unsupported_scope");

/// 只由生产入口注入原生效果，MockRuntime 不构造菜单或托盘。
pub trait TrayAdapter: Send + Sync {
    fn create(&self) -> Result<(), AppError>;
    fn remove(&self) -> Result<(), AppError>;
    fn show_main(&self) -> Result<(), AppError>;
    fn hide_main(&self) -> Result<(), AppError>;
}

#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub enum TrayStatus {
    Disabled,
    Ready,
    Unavailable,
}

#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct TraySettings {
    pub enabled: Setting<bool>,
    pub close_action: Setting<WindowCloseAction>,
    pub state: TrayStatus,
    pub error: Option<IpcError>,
}

#[derive(Default)]
struct State {
    live: bool,
    close_action: WindowCloseAction,
    stopped: bool,
    failure: Option<NativeFailure>,
}

#[derive(Debug, PartialEq, Eq)]
pub enum CloseOutcome {
    Exit,
    KeepOpen,
    Ask { tray_available: bool },
}

#[derive(Clone, Copy)]
pub enum TrayAction {
    Show,
    Exit,
}

impl TrayAction {
    pub fn from_menu(id: &str) -> Option<Self> {
        match id {
            "tray.show" => Some(Self::Show),
            "tray.exit" => Some(Self::Exit),
            _ => None,
        }
    }

    pub fn dispatch(self, show: impl FnOnce(), exit: impl FnOnce()) {
        match self {
            Self::Show => show(),
            Self::Exit => exit(),
        }
    }
}

pub struct Tray {
    adapter: Option<Arc<dyn TrayAdapter>>,
    operation: Mutex<State>,
}

impl Tray {
    pub fn new(adapter: Option<Arc<dyn TrayAdapter>>) -> Self {
        Self {
            adapter,
            operation: Mutex::new(State::default()),
        }
    }

    /// main 已创建后调用；失败保留配置意图，首屏显示仍由 WindowReveal 管理。
    pub fn start(&self, config: &Mutex<LoadedConfig>) -> Result<(), AppError> {
        let mut state = super::lock(&self.operation)?;
        let desired = super::lock(config)?.native_settings();
        state.close_action = desired.close_action.value;
        if desired.tray_enabled.value {
            match self
                .adapter
                .as_ref()
                .ok_or(UNSUPPORTED)
                .and_then(|adapter| adapter.create().map_err(|error| error.code()))
            {
                Ok(()) => state.live = true,
                Err(code) => {
                    state.failure = Some(NativeFailure::new(code));
                }
            }
        }
        Ok(())
    }

    pub(super) fn available(&self) -> Result<bool, AppError> {
        Ok(super::lock(&self.operation)?.live)
    }

    pub fn settings(
        &self,
        config: &Mutex<LoadedConfig>,
        trace_id: &str,
    ) -> Result<TraySettings, AppError> {
        let state = super::lock(&self.operation)?;
        let desired = super::lock(config)?.native_settings();
        Ok(TraySettings {
            state: if state.live {
                TrayStatus::Ready
            } else if desired.tray_enabled.value {
                TrayStatus::Unavailable
            } else {
                TrayStatus::Disabled
            },
            enabled: desired.tray_enabled,
            close_action: desired.close_action,
            error: state
                .failure
                .or_else(|| {
                    self.adapter
                        .is_none()
                        .then(|| NativeFailure::new(UNSUPPORTED))
                })
                .map(|failure| failure.ipc(trace_id)),
        })
    }

    pub fn update(
        &self,
        config: &Mutex<LoadedConfig>,
        root: &Path,
        input: &TraySettingsChange,
    ) -> Result<(), AppError> {
        let mut state = super::lock(&self.operation)?;
        if state.stopped {
            return Err(AppError::new(LIFECYCLE_CLOSING));
        }
        let mut config = super::lock(config)?;
        let desired = config.native_settings();
        check_source(desired.tray_enabled.source, "tray.enabled")?;
        check_source(desired.close_action.source, "window.close_action")?;
        if input.close_action == WindowCloseAction::Tray && !input.enabled {
            return Err(AppError::new(INPUT_INVALID).with_param("path", "window.close_action"));
        }
        let adapter = self
            .adapter
            .as_ref()
            .ok_or_else(|| AppError::new(UNSUPPORTED))?;
        let persist = || {
            config
                .update_native_settings(
                    root,
                    &NativeSettingsChange::Tray(TraySettingsChange {
                        enabled: input.enabled,
                        close_action: input.close_action,
                    }),
                )
                .map(|_| ())
                .map_err(|_| AppError::new(UNAVAILABLE))
        };
        let result = Self::change(&mut state, adapter.as_ref(), input, persist);
        state.failure = result.err();
        state.failure.map_or(Ok(()), |failure| Err(failure.error()))
    }

    fn change(
        state: &mut State,
        adapter: &dyn TrayAdapter,
        input: &TraySettingsChange,
        persist: impl FnOnce() -> Result<(), AppError>,
    ) -> Result<(), NativeFailure> {
        let created = input.enabled && !state.live;
        if created {
            adapter
                .create()
                .map_err(|error| NativeFailure::new(error.code()))?;
            state.live = true;
        }
        if !input.enabled {
            // 显示失败则不写配置、不释放图标，用户仍能从托盘找回窗口。
            adapter
                .show_main()
                .map_err(|error| NativeFailure::new(error.code()))?;
        }
        if let Err(error) = persist() {
            let compensation = if created {
                adapter
                    .show_main()
                    .and_then(|()| adapter.remove())
                    .map(|()| state.live = false)
            } else {
                Ok(())
            };
            return Err(NativeFailure {
                operation: error.code(),
                compensation: compensation.err().map(|error| error.code()),
            });
        }
        state.close_action = input.close_action;
        if !input.enabled && state.live {
            adapter
                .remove()
                .map_err(|error| NativeFailure::new(error.code()))?;
            state.live = false;
        }
        Ok(())
    }

    /// 原生事件线程不能等正在调度主线程的设置事务；pending 时保持窗口。
    pub fn close_requested(&self) -> Result<CloseOutcome, AppError> {
        let mut state = match self.operation.try_lock() {
            Ok(state) => state,
            Err(TryLockError::WouldBlock) => return Ok(CloseOutcome::KeepOpen),
            Err(TryLockError::Poisoned(_)) => {
                return Err(AppError::new(tenon_framework::error::INTERNAL_UNEXPECTED));
            }
        };
        if state.stopped {
            return Ok(CloseOutcome::KeepOpen);
        }
        match state.close_action {
            WindowCloseAction::Exit => Ok(CloseOutcome::Exit),
            WindowCloseAction::Ask => Ok(CloseOutcome::Ask {
                tray_available: state.live,
            }),
            WindowCloseAction::Tray if !state.live => Ok(CloseOutcome::Exit),
            WindowCloseAction::Tray => self.hide(&mut state),
        }
    }

    /// 询问选择与设置保存共用托盘事务锁；记住时整组核对来源，保留当前托盘意图。
    pub fn close_decided(
        &self,
        config: &Mutex<LoadedConfig>,
        root: &Path,
        action: super::window_controls::CloseChoice,
        remember: bool,
    ) -> Result<CloseOutcome, AppError> {
        let mut state = super::lock(&self.operation)?;
        if state.stopped {
            return Err(AppError::new(LIFECYCLE_CLOSING));
        }
        let action = match action {
            super::window_controls::CloseChoice::Tray => WindowCloseAction::Tray,
            super::window_controls::CloseChoice::Exit => WindowCloseAction::Exit,
        };
        if action == WindowCloseAction::Tray && !state.live {
            return Err(AppError::new(UNAVAILABLE));
        }
        if remember {
            let mut config = super::lock(config)?;
            let desired = config.native_settings();
            check_source(desired.tray_enabled.source, "tray.enabled")?;
            check_source(desired.close_action.source, "window.close_action")?;
            config
                .update_native_settings(
                    root,
                    &NativeSettingsChange::Tray(TraySettingsChange {
                        enabled: desired.tray_enabled.value,
                        close_action: action,
                    }),
                )
                .map_err(|_| AppError::new(UNAVAILABLE))?;
            state.close_action = action;
        }
        match action {
            WindowCloseAction::Tray => self.hide(&mut state),
            WindowCloseAction::Exit => Ok(CloseOutcome::Exit),
            WindowCloseAction::Ask => Err(AppError::new(INPUT_INVALID)),
        }
    }

    fn hide(&self, state: &mut State) -> Result<CloseOutcome, AppError> {
        let adapter = self
            .adapter
            .as_ref()
            .ok_or_else(|| AppError::new(UNSUPPORTED))?;
        if let Err(error) = adapter.hide_main() {
            let failure = NativeFailure {
                operation: error.code(),
                compensation: adapter.show_main().err().map(|error| error.code()),
            };
            state.failure = Some(failure);
            return Err(failure.error());
        }
        Ok(CloseOutcome::KeepOpen)
    }

    pub fn shutdown(&self) -> Result<(), AppError> {
        let mut state = super::lock(&self.operation)?;
        state.stopped = true;
        state.close_action = WindowCloseAction::Exit;
        if state.live {
            let adapter = self
                .adapter
                .as_ref()
                .ok_or_else(|| AppError::new(UNSUPPORTED))?;
            adapter.show_main()?;
            adapter.remove()?;
            state.live = false;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn poisoned_close_lock_returns_error_without_panicking() {
        let tray = Tray::new(None);
        std::thread::scope(|scope| {
            assert!(
                scope
                    .spawn(|| {
                        let _guard = tray.operation.lock().unwrap();
                        panic!("poison fixture");
                    })
                    .join()
                    .is_err()
            );
        });
        assert_eq!(
            tray.close_requested().unwrap_err().code(),
            tenon_framework::error::INTERNAL_UNEXPECTED
        );
    }
}
