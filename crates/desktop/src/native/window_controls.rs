//! 关闭与未保存编辑确认；无身份 Control 入口，窗口效果和事件传输由宿主注入。

use std::{
    path::Path,
    sync::{Arc, Mutex},
};

use serde::{Deserialize, Serialize};
use tenon_framework::{
    error::{AppError, ErrorCode, INPUT_INVALID, PERMISSION_DENIED},
    maintenance::{LIFECYCLE_CLOSING, OperationGate},
};

use ts_rs::TS;

use super::{
    UNAVAILABLE,
    tray::{CloseOutcome, Tray},
};
use crate::config::LoadedConfig;

/// 原始窗口事件通道；宿主闭包只发送事件，不能重入此控制器。
pub type WindowEvents = Box<dyn Fn(WindowEvent) -> Result<(), AppError> + Send + Sync>;

pub const EDIT_UNAVAILABLE: ErrorCode = ErrorCode::new("app.window.edit_unavailable");

#[derive(Clone, Debug, PartialEq, Eq, Serialize, TS)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum WindowEvent {
    FilesChanged,
    Moved {
        x: i32,
        y: i32,
    },
    State {
        maximized: bool,
        focused: bool,
    },
    CloseAsk {
        #[serde(rename = "trayAvailable")]
        tray_available: bool,
    },
    CloseEdit {
        #[serde(rename = "requestId")]
        request_id: String,
    },
}

#[derive(Clone, Copy, Debug, Default, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct WindowEditState {
    pub dirty: bool,
    pub pending: bool,
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WindowEditDecision {
    pub request_id: String,
    pub proceed: bool,
}

#[derive(Clone, Copy)]
enum EditIntent {
    WindowClose,
    Exit,
}

struct PendingEdit {
    id: String,
    intent: EditIntent,
}

#[derive(Clone, Copy, Debug, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
pub enum CloseChoice {
    Tray,
    Exit,
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WindowCloseDecision {
    pub action: CloseChoice,
    pub remember: bool,
}

/// 退出与原生询问只由生产入口注入，测试不构造 Wry/原生对话框。
pub trait WindowActions: Send + Sync {
    fn exit(&self);
    fn ask(&self, tray_available: bool) -> Result<(), AppError>;
}

#[derive(Default)]
struct State {
    subscriber: Option<WindowEvents>,
    last: Option<WindowEvent>,
    asking: bool,
    native_asking: bool,
    deciding: bool,
    stopped: bool,
    edit: WindowEditState,
    edit_request: Option<PendingEdit>,
}

pub struct WindowControls {
    state: Mutex<State>,
    gate: OperationGate,
    actions: Arc<dyn WindowActions>,
}

impl WindowControls {
    pub fn new(gate: OperationGate, actions: Arc<dyn WindowActions>) -> Self {
        Self {
            state: Mutex::new(State::default()),
            gate,
            actions,
        }
    }

    pub fn watch(
        &self,
        tray: &Tray,
        channel: WindowEvents,
        snapshot: WindowEvent,
    ) -> Result<(), AppError> {
        let tray_available = tray.available()?;
        let mut state = super::lock(&self.state)?;
        self.gate.enter_control()?;
        if state.stopped {
            return Err(AppError::new(LIFECYCLE_CLOSING));
        }
        // 丢弃最后一个旧 Channel 句柄会通知 WebView 注销旧回调。
        state.subscriber = Some(channel);
        state.last = Some(snapshot.clone());
        if !self.send(&mut state, snapshot) {
            return Err(AppError::new(UNAVAILABLE));
        }
        if let Some(request) = &state.edit_request {
            let event = WindowEvent::CloseEdit {
                request_id: request.id.clone(),
            };
            if !self.send(&mut state, event) {
                return Err(AppError::new(EDIT_UNAVAILABLE));
            }
        }
        if state.asking
            && !state.native_asking
            && !self.send(&mut state, WindowEvent::CloseAsk { tray_available })
        {
            return Err(AppError::new(UNAVAILABLE));
        }
        Ok(())
    }

    pub fn changed(&self, snapshot: WindowEvent) -> Result<(), AppError> {
        let mut state = super::lock(&self.state)?;
        if state.stopped || self.gate.is_closing() || state.last.as_ref() == Some(&snapshot) {
            return Ok(());
        }
        state.last = Some(snapshot.clone());
        self.send(&mut state, snapshot);
        Ok(())
    }

    fn send(&self, state: &mut State, event: WindowEvent) -> bool {
        if !self.gate.is_closing()
            && !state.stopped
            && state
                .subscriber
                .as_ref()
                .is_some_and(|channel| channel(event).is_ok())
        {
            true
        } else {
            state.subscriber = None;
            false
        }
    }

    pub fn moved(&self, x: i32, y: i32) -> Result<(), AppError> {
        let mut state = super::lock(&self.state)?;
        // Movement is transient; keep the last state snapshot for deduplication.
        self.send(&mut state, WindowEvent::Moved { x, y });
        Ok(())
    }

    pub fn files_changed(&self) -> Result<(), AppError> {
        let mut state = super::lock(&self.state)?;
        self.send(&mut state, WindowEvent::FilesChanged);
        Ok(())
    }

    /// 系统关闭与 app_window_close 的 CloseRequested 共同进入这里。
    pub fn close_requested(&self, tray: &Tray) -> Result<(), AppError> {
        if self.guard_edit(EditIntent::WindowClose)? {
            return Ok(());
        }
        self.close_after_edit(tray)
    }

    fn close_after_edit(&self, tray: &Tray) -> Result<(), AppError> {
        let mut state = super::lock(&self.state)?;
        if state.stopped || self.gate.is_closing() || state.deciding || state.native_asking {
            return Ok(());
        }
        if state.edit.dirty || state.edit.pending {
            return Err(AppError::new(EDIT_UNAVAILABLE));
        }
        state.deciding = true;
        drop(state);
        // hide/show 可能同步引发焦点事件；不能持事件锁调用原生窗口 API。
        let outcome = tray.close_requested();
        let mut state = super::lock(&self.state)?;
        state.deciding = false;
        if state.stopped || self.gate.is_closing() {
            return Ok(());
        }
        match outcome? {
            CloseOutcome::KeepOpen => Ok(()),
            CloseOutcome::Exit => {
                state.asking = false;
                drop(state);
                self.actions.exit();
                Ok(())
            }
            CloseOutcome::Ask { tray_available } => {
                state.asking = true;
                if self.send(&mut state, WindowEvent::CloseAsk { tray_available }) {
                    return Ok(());
                }
                state.native_asking = true;
                drop(state);
                let result = self.actions.ask(tray_available);
                if result.is_err() {
                    self.cancel_native_ask()?;
                }
                result
            }
        }
    }

    /// Explicit menu/OS Quit must exit after consent, even when the close button hides to tray.
    pub fn exit_requested(&self) -> Result<(), AppError> {
        if !self.guard_edit(EditIntent::Exit)? {
            self.exit_after_edit()?;
        }
        Ok(())
    }

    fn exit_after_edit(&self) -> Result<(), AppError> {
        let state = super::lock(&self.state)?;
        if state.stopped || self.gate.is_closing() {
            return Ok(());
        }
        if state.edit.dirty || state.edit.pending {
            return Err(AppError::new(EDIT_UNAVAILABLE));
        }
        drop(state);
        self.actions.exit();
        Ok(())
    }

    fn guard_edit(&self, intent: EditIntent) -> Result<bool, AppError> {
        let mut state = super::lock(&self.state)?;
        if state.stopped || self.gate.is_closing() {
            return Ok(true);
        }
        // A live page must answer even when the last published state was clean:
        // its first dirty-state IPC may still be queued behind this native close.
        if !state.edit.dirty
            && !state.edit.pending
            && state.subscriber.is_none()
            && state.edit_request.is_none()
        {
            return Ok(false);
        }
        let request = state.edit_request.get_or_insert_with(|| PendingEdit {
            id: uuid::Uuid::new_v4().to_string(),
            intent,
        });
        // An explicit Quit upgrades an already pending window-close request.
        if matches!(intent, EditIntent::Exit) {
            request.intent = intent;
        }
        let event = WindowEvent::CloseEdit {
            request_id: request.id.clone(),
        };
        if !self.send(&mut state, event) {
            // Keep the edit state and request across a missing/reloading subscriber.
            return Err(AppError::new(EDIT_UNAVAILABLE));
        }
        Ok(true)
    }

    pub fn edit_state(&self, input: WindowEditState) -> Result<(), AppError> {
        self.gate.enter_control()?;
        let mut state = super::lock(&self.state)?;
        if state.stopped {
            return Err(AppError::new(LIFECYCLE_CLOSING));
        }
        state.edit = input;
        Ok(())
    }

    pub fn edit_decide(&self, tray: &Tray, input: WindowEditDecision) -> Result<(), AppError> {
        self.gate.enter_control()?;
        if input.request_id.len() != 36 || uuid::Uuid::parse_str(&input.request_id).is_err() {
            return Err(AppError::new(INPUT_INVALID));
        }
        let intent = {
            let mut state = super::lock(&self.state)?;
            if state.stopped {
                return Err(AppError::new(LIFECYCLE_CLOSING));
            }
            if state
                .edit_request
                .as_ref()
                .is_none_or(|request| request.id != input.request_id)
            {
                return Ok(());
            }
            if !input.proceed {
                state.edit_request = None;
                return Ok(());
            }
            if state.edit.dirty || state.edit.pending {
                return Err(AppError::new(INPUT_INVALID));
            }
            state
                .edit_request
                .take()
                .ok_or_else(|| AppError::new(INPUT_INVALID))?
                .intent
        };
        match intent {
            EditIntent::WindowClose => self.close_after_edit(tray),
            EditIntent::Exit => self.exit_after_edit(),
        }
    }

    pub fn decide(
        &self,
        tray: &Tray,
        config: &Mutex<LoadedConfig>,
        root: &Path,
        input: WindowCloseDecision,
    ) -> Result<(), AppError> {
        {
            let mut state = super::lock(&self.state)?;
            self.gate.enter_control()?;
            if state.stopped {
                return Err(AppError::new(LIFECYCLE_CLOSING));
            }
            if !state.asking || state.deciding {
                return Err(AppError::new(INPUT_INVALID));
            }
            if state.edit.dirty || state.edit.pending {
                return Err(AppError::new(EDIT_UNAVAILABLE));
            }
            state.deciding = true;
        }
        // 文件事务与原生效果不能持事件锁，避免主线程和配置保存相互等待。
        let result = tray.close_decided(config, root, input.action, input.remember);
        {
            let mut state = super::lock(&self.state)?;
            state.deciding = false;
            state.native_asking = false;
            state.asking = result.is_err() && !state.stopped;
        }
        if result? == CloseOutcome::Exit {
            self.actions.exit();
        }
        Ok(())
    }

    pub fn cancel_native_ask(&self) -> Result<(), AppError> {
        let mut state = super::lock(&self.state)?;
        state.native_asking = false;
        state.asking = false;
        Ok(())
    }

    pub fn page_loading(&self) -> Result<(), AppError> {
        let mut state = super::lock(&self.state)?;
        state.subscriber = None;
        state.last = None;
        // 未回答的 close/edit 请求保留，下一页面订阅时重发。
        Ok(())
    }

    pub fn shutdown(&self) -> Result<(), AppError> {
        let mut state = super::lock(&self.state)?;
        state.stopped = true;
        state.subscriber = None;
        state.asking = false;
        state.edit_request = None;
        Ok(())
    }
}

pub fn require_main(label: &str) -> Result<(), AppError> {
    if label == "main" {
        Ok(())
    } else {
        Err(AppError::new(PERMISSION_DENIED))
    }
}

#[cfg(test)]
mod tests;
