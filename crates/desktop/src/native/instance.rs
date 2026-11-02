//! 单实例显示意图与显式根比较；不解析设置载荷、不创建目录。

use std::{path::PathBuf, sync::Mutex};
use tenon_framework::{error::AppError, maintenance::OperationGate};

/// 首窗创建前至多保留一个显示意图；根已知后才接受显式异根比较。
pub struct MainWindowIntent {
    gate: OperationGate,
    state: Mutex<WindowState>,
}

#[derive(Default)]
struct WindowState {
    root: Option<PathBuf>,
    ready: bool,
    pending: Option<Option<PathBuf>>,
}

impl MainWindowIntent {
    pub fn new(gate: OperationGate) -> Self {
        Self {
            gate,
            state: Mutex::new(WindowState::default()),
        }
    }

    pub fn set_root(&self, root: PathBuf) -> Result<(), AppError> {
        super::lock(&self.state)?.root = Some(root);
        Ok(())
    }

    pub fn request_show(&self, requested_root: Option<PathBuf>) -> Result<bool, AppError> {
        let mut state = super::lock(&self.state)?;
        if self.gate.is_closing() {
            return Ok(false);
        }
        if let (Some(requested_root), Some(root)) = (&requested_root, &state.root)
            && root != requested_root
        {
            return Ok(false);
        }
        if state.ready {
            Ok(true)
        } else {
            state.pending = Some(requested_root);
            Ok(false)
        }
    }

    pub fn ready(&self) -> Result<bool, AppError> {
        let mut state = super::lock(&self.state)?;
        state.ready = true;
        let pending = state.pending.take();
        let matches = match pending {
            Some(None) => true,
            Some(Some(root)) => state.root.as_ref() == Some(&root),
            None => false,
        };
        Ok(matches && !self.gate.is_closing())
    }
}

/// 只读取官方单实例回调可观察的显式参数；不解析 --set，不创建任何目录。
pub fn secondary_root(args: &[String], cwd: &str) -> Result<Option<PathBuf>, &'static str> {
    let mut root = None;
    let mut arguments = args.iter().skip(1);
    while let Some(argument) = arguments.next() {
        if argument == "--set" {
            arguments.next();
            continue;
        }
        if argument == "--" {
            break;
        }
        let value = if argument == "--state-root" {
            Some(arguments.next().ok_or("invalid_state_root")?.as_str())
        } else {
            argument.strip_prefix("--state-root=")
        };
        if let Some(value) = value {
            if value.is_empty() || root.is_some() {
                return Err("invalid_state_root");
            }
            let path = PathBuf::from(value);
            let path = if path.is_absolute() {
                path
            } else {
                PathBuf::from(cwd).join(path)
            };
            let path = path.canonicalize().map_err(|_| "unavailable_state_root")?;
            if !path.is_dir() {
                return Err("unavailable_state_root");
            }
            root = Some(path);
        }
    }
    Ok(root)
}
