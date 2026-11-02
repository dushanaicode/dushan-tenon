//! 仅 app.show 的注册事务；宿主复用插件解析器和保留键策略，Wayland 注入 None，回调不取事务锁。

use std::{
    path::Path,
    sync::{
        Arc, Mutex,
        atomic::{AtomicU64, Ordering},
    },
};

use serde::Serialize;
use tenon_framework::{
    error::{AppError, ErrorCode, IpcError},
    maintenance::LIFECYCLE_CLOSING,
};
use ts_rs::TS;

use super::{NativeFailure, UNAVAILABLE, check_source, lock};
use crate::config::{LoadedConfig, NativeSettingsChange, Setting, ShortcutSettingsChange};

pub const INVALID: ErrorCode = ErrorCode::new("app.shortcut.invalid");
pub const CONFLICT: ErrorCode = ErrorCode::new("app.shortcut.conflict");
pub const UNSUPPORTED: ErrorCode = ErrorCode::new("app.shortcut.unsupported");

/// 插件解析出的规范绑定与事件 ID，不包含自定义键码表。
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ParsedShortcut {
    pub id: u32,
    pub binding: String,
}

pub trait ShortcutAdapter: Send + Sync {
    /// 使用插件解析并检查平台保留键，失败返回 INVALID。
    fn parse(&self, binding: &str) -> Result<ParsedShortcut, AppError>;
    fn register(&self, shortcut: &ParsedShortcut) -> Result<(), AppError>;
    fn unregister(&self, shortcut: &ParsedShortcut) -> Result<(), AppError>;
}

#[derive(Default)]
pub struct ShortcutActivation(AtomicU64);

impl ShortcutActivation {
    fn activate(&self, key: Option<&ParsedShortcut>) {
        self.0.store(
            key.map_or(0, |key| (u64::from(key.id) + 1) << 1),
            Ordering::SeqCst,
        );
    }

    /// 宿主把 Pressed 映射为 true；每次首次按下才显示 main，不解锁。
    pub fn pressed(&self, id: u32, pressed: bool) -> bool {
        let key = (u64::from(id) + 1) << 1;
        if pressed {
            self.0
                .compare_exchange(key, key | 1, Ordering::SeqCst, Ordering::SeqCst)
                .is_ok()
        } else {
            let _ = self
                .0
                .compare_exchange(key | 1, key, Ordering::SeqCst, Ordering::SeqCst);
            false
        }
    }
}

#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub enum ShortcutStatus {
    Unsupported,
    Disabled,
    Ready,
    Unavailable,
    Degraded,
}

#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct ShortcutSettings {
    pub desired: Setting<String>,
    pub active: Option<String>,
    pub registered: Vec<String>,
    pub state: ShortcutStatus,
    pub error: Option<IpcError>,
}

#[derive(Default)]
struct State {
    owned: Vec<ParsedShortcut>,
    active: Option<ParsedShortcut>,
    failure: Option<NativeFailure>,
    stopped: bool,
}

pub struct Shortcuts {
    adapter: Option<Arc<dyn ShortcutAdapter>>,
    activation: Arc<ShortcutActivation>,
    operation: Mutex<State>,
}

impl Shortcuts {
    pub fn new(
        adapter: Option<Arc<dyn ShortcutAdapter>>,
        activation: Arc<ShortcutActivation>,
        binding: &str,
    ) -> Self {
        let mut state = State::default();
        if let Some(adapter) = &adapter {
            match parse(adapter.as_ref(), binding) {
                Ok(Some(key)) => match adapter.register(&key) {
                    Ok(()) => {
                        state.owned.push(key.clone());
                        state.active = Some(key);
                    }
                    Err(_) => state.failure = Some(NativeFailure::new(CONFLICT)),
                },
                Ok(None) => (),
                Err(error) => state.failure = Some(NativeFailure::new(error.code())),
            }
        }
        activation.activate(state.active.as_ref());
        Self {
            adapter,
            activation,
            operation: Mutex::new(state),
        }
    }

    pub fn settings(
        &self,
        config: &Mutex<LoadedConfig>,
        trace: &str,
    ) -> Result<ShortcutSettings, AppError> {
        let state = lock(&self.operation)?;
        let status = if self.adapter.is_none() {
            ShortcutStatus::Unsupported
        } else if state.failure.is_some_and(|f| f.compensation.is_some()) {
            ShortcutStatus::Degraded
        } else if state.failure.is_some() {
            ShortcutStatus::Unavailable
        } else if state.active.is_some() {
            ShortcutStatus::Ready
        } else {
            ShortcutStatus::Disabled
        };
        Ok(ShortcutSettings {
            desired: lock(config)?.native_settings().show_main,
            active: state.active.as_ref().map(|key| key.binding.clone()),
            registered: state.owned.iter().map(|key| key.binding.clone()).collect(),
            state: status,
            error: state.failure.map(|failure| failure.ipc(trace)),
        })
    }

    pub fn update(
        &self,
        config: &Mutex<LoadedConfig>,
        root: &Path,
        binding: &str,
    ) -> Result<(), AppError> {
        let mut state = lock(&self.operation)?;
        let mut config = lock(config)?;
        check_source(
            config.native_settings().show_main.source,
            "shortcuts.show_main",
        )?;
        let adapter = self
            .adapter
            .as_ref()
            .ok_or_else(|| AppError::new(UNSUPPORTED))?;
        let key = parse(adapter.as_ref(), binding)?;
        let normalized = key
            .as_ref()
            .map_or_else(String::new, |key| key.binding.clone());
        self.apply(&mut state, key, || {
            config
                .update_native_settings(
                    root,
                    &NativeSettingsChange::Shortcut(ShortcutSettingsChange {
                        binding: normalized,
                    }),
                )
                .map(|_| ())
                .map_err(|_| AppError::new(UNAVAILABLE))
        })
    }

    fn register(&self, state: &mut State, key: &ParsedShortcut) -> Result<(), ErrorCode> {
        self.adapter
            .as_ref()
            .ok_or(UNSUPPORTED)?
            .register(key)
            .map_err(|_| CONFLICT)?;
        state.owned.push(key.clone());
        Ok(())
    }

    fn unregister(&self, state: &mut State, key: &ParsedShortcut) -> Result<(), ErrorCode> {
        self.adapter
            .as_ref()
            .ok_or(UNSUPPORTED)?
            .unregister(key)
            .map_err(|_| UNAVAILABLE)?;
        state.owned.retain(|owned| owned != key);
        Ok(())
    }

    fn activate(&self, state: &mut State, key: Option<ParsedShortcut>) {
        self.activation.activate(key.as_ref());
        state.active = key;
    }

    fn apply(
        &self,
        state: &mut State,
        new: Option<ParsedShortcut>,
        persist: impl FnOnce() -> Result<(), AppError>,
    ) -> Result<(), AppError> {
        if state.stopped {
            return Err(AppError::new(LIFECYCLE_CLOSING));
        }
        state.failure = self.change(state, new, persist).err();
        state.failure.map_or(Ok(()), |failure| Err(failure.error()))
    }

    fn change(
        &self,
        state: &mut State,
        new: Option<ParsedShortcut>,
        persist: impl FnOnce() -> Result<(), AppError>,
    ) -> Result<(), NativeFailure> {
        let leftovers: Vec<_> = state
            .owned
            .iter()
            .filter(|key| Some(*key) != state.active.as_ref())
            .cloned()
            .collect();
        for key in leftovers {
            if let Err(code) = self.unregister(state, &key) {
                return Err(NativeFailure {
                    operation: UNAVAILABLE,
                    compensation: Some(code),
                });
            }
        }
        let old = state.active.clone();
        if old == new {
            return persist().map_err(|e| NativeFailure::new(e.code()));
        }
        if let Some(new) = &new {
            self.register(state, new).map_err(NativeFailure::new)?;
        }
        if let Some(old) = &old {
            if let Err(code) = self.unregister(state, old) {
                let compensation = new
                    .as_ref()
                    .and_then(|new| self.unregister(state, new).err());
                return Err(NativeFailure {
                    operation: code,
                    compensation,
                });
            }
            self.activate(state, None);
        }
        if let Err(error) = persist() {
            let mut compensation = None;
            if let Some(old) = old {
                match self.register(state, &old) {
                    Ok(()) => self.activate(state, Some(old)),
                    Err(code) => compensation = Some(code),
                }
            }
            if let Some(new) = &new {
                let released = self.unregister(state, new);
                if compensation.is_none() {
                    compensation = released.err();
                }
            }
            return Err(NativeFailure {
                operation: error.code(),
                compensation,
            });
        }
        self.activate(state, new);
        Ok(())
    }

    pub fn shutdown(&self) -> Result<(), AppError> {
        let mut state = lock(&self.operation)?;
        state.stopped = true;
        self.activate(&mut state, None);
        let mut failure = None;
        for key in state.owned.clone() {
            if let Err(code) = self.unregister(&mut state, &key) {
                failure = Some(code);
            }
        }
        state.failure = failure.map(NativeFailure::new);
        failure.map_or(Ok(()), |code| Err(AppError::new(code)))
    }
}

fn parse(adapter: &dyn ShortcutAdapter, binding: &str) -> Result<Option<ParsedShortcut>, AppError> {
    let binding = binding.trim();
    if binding.is_empty() {
        return Ok(None);
    }
    if binding.len() > 128 {
        return Err(AppError::new(INVALID));
    }
    adapter
        .parse(binding)
        .map(Some)
        .map_err(|_| AppError::new(INVALID))
}

#[cfg(test)]
mod tests;
