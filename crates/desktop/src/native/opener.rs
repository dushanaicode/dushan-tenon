//! 固定目录映射；仅允许已有状态根内目录，系统 opener 由宿主注入。

use std::{
    path::{Path, PathBuf},
    sync::Arc,
};

use serde::Deserialize;
use tenon_framework::error::{AppError, ErrorCode};
use ts_rs::TS;

pub const OPEN_UNAVAILABLE: ErrorCode = ErrorCode::new("app.open.unavailable");

#[derive(Clone, Copy, Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub enum KnownTarget {
    StateDirectory,
    LogDirectory,
    ConfigDirectory,
    Support,
}

#[derive(Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OpenKnownTargetInput {
    pub target: KnownTarget,
}

type OpenDirectory = dyn Fn(&Path) -> Result<(), AppError> + Send + Sync;

/// 生产 OS 效果在 run 边界注入；MockRuntime 不创建真实原生对象。
pub struct KnownTargets {
    root: PathBuf,
    open_directory: Arc<OpenDirectory>,
}

impl KnownTargets {
    pub fn new(root: &Path, open_directory: Arc<OpenDirectory>) -> Result<Self, AppError> {
        Ok(Self {
            root: root
                .canonicalize()
                .map_err(|_| AppError::new(OPEN_UNAVAILABLE))?,
            open_directory,
        })
    }

    pub fn open(&self, target: KnownTarget) -> Result<(), AppError> {
        let path = match target {
            KnownTarget::StateDirectory | KnownTarget::ConfigDirectory => self.root.clone(),
            KnownTarget::LogDirectory => self.root.join("logs"),
            // 当前没有受审品牌 HTTPS 常量；不接收外部 URL，也不提供占位链接。
            KnownTarget::Support => return Err(AppError::new(OPEN_UNAVAILABLE)),
        };
        let resolved = path
            .canonicalize()
            .map_err(|_| AppError::new(OPEN_UNAVAILABLE))?;
        if !resolved.starts_with(&self.root) || !resolved.is_dir() {
            return Err(AppError::new(OPEN_UNAVAILABLE));
        }
        (self.open_directory)(&resolved).map_err(|_| AppError::new(OPEN_UNAVAILABLE))
    }
}
