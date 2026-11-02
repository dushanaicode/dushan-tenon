//! 更新候选、下载与安装状态机；发行配置、签名/版本校验、网络及系统安装由宿主 driver 实现。
//! 宿主 check/download 先校验活动 owner/main；install 维护命令写完日志、释放许可后才执行 InstallPlan。

use std::{
    future::Future,
    path::{Path, PathBuf},
    pin::Pin,
    sync::{
        Arc, Mutex,
        atomic::{AtomicU64, Ordering},
    },
    time::Instant,
};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tenon_framework::{
    actor::Actor,
    error::{AppError, ErrorCode, IpcError, PERMISSION_DENIED},
    maintenance::OPERATION_BUSY,
    network::ProxySnapshot,
    stream::{Stream, StreamOwner},
};
use ts_rs::TS;

use super::{check_source, lock};
use crate::{
    config::{LoadedConfig, NativeSettingsChange, UpdaterSettingsChange},
    data::{OperationPhase, OperationProgress, OperationUnit},
};

pub const UNCONFIGURED: ErrorCode = ErrorCode::new("app.update.unconfigured");
pub const INVALID_RELEASE: ErrorCode = ErrorCode::new("app.update.invalid_release");
pub const SIGNATURE_INVALID: ErrorCode = ErrorCode::new("app.update.signature_invalid");
pub const DOWNLOAD_TOO_LARGE: ErrorCode = ErrorCode::new("app.update.download_too_large");
pub const INSTALL_FAILED: ErrorCode = ErrorCode::new("app.update.install_failed");
pub const CHECK_FAILED: ErrorCode = ErrorCode::new("app.update.check_failed");
pub const DOWNLOAD_FAILED: ErrorCode = ErrorCode::new("app.update.download_failed");
pub const MANIFEST_LIMIT: u64 = 1024 * 1024;
pub const DOWNLOAD_LIMIT: u64 = 250 * 1024 * 1024;

pub type UpdateFuture<'a, T> = Pin<Box<dyn Future<Output = Result<T, AppError>> + Send + 'a>>;
/// 必须阻塞到共享 ExitController/Started.shutdown 与宿主 cleanup 全部完成。
pub type BeforeExit = Arc<dyn Fn() + Send + Sync>;
pub type DownloadProgress = Arc<dyn Fn(usize, Option<u64>) + Send + Sync>;

pub trait UpdateDriver: Send + Sync {
    /// HTTPS、精确下载 host、禁止重定向；manifest 实际读取最多 MANIFEST_LIMIT。
    /// 只返回高于当前版本的候选，requireSignedVersion=true、allowDowngrades=false。
    /// 保存同一受限代理快照与候选，供 download 使用，不能重新读取设置。
    fn check(
        &self,
        proxy: Arc<ProxySnapshot>,
        scratch: PathBuf,
    ) -> UpdateFuture<'_, Option<ReleaseInfo>>;
    /// 实际下载限 DOWNLOAD_LIMIT；必须校验 minisign 与签名版本匹配候选才返回字节。
    /// 错误映射为 SIGNATURE_INVALID / DOWNLOAD_TOO_LARGE / DOWNLOAD_FAILED 等安全代码。
    fn download(&self, progress: DownloadProgress) -> UpdateFuture<'_, Vec<u8>>;
    /// desktop 已等待完整关闭；宿主使用同一候选执行插件安装/restart，禁止启动新的业务。
    fn install(&self, bytes: Vec<u8>) -> Result<(), AppError>;
}

pub struct ReleaseInfo {
    pub version: String,
    pub published_at: Option<String>,
    pub notes: String,
}

#[derive(Clone, Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct UpdateRelease {
    pub update_id: String,
    pub version: String,
    pub published_at: Option<String>,
    pub notes: String,
    #[ts(type = "number | null")]
    pub bytes: Option<u64>,
}

#[derive(Serialize, TS)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum UpdateState {
    Unconfigured,
    Idle,
    Checking,
    UpToDate,
    Available { release: UpdateRelease },
    Downloading { release: UpdateRelease },
    Verified { release: UpdateRelease },
    Closing { version: String },
    Installing { version: String },
    Failed { error: IpcError },
    StoppedAfterInstallFailure { error: IpcError },
}

#[derive(Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UpdateDownloadInput {
    pub update_id: String,
}

#[derive(Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UpdateInstallInput {
    pub update_id: String,
}

struct Candidate {
    release: UpdateRelease,
    owner: StreamOwner,
    scratch: tempfile::TempDir,
}
struct Verified {
    candidate: Candidate,
    bytes: Vec<u8>,
    digest: [u8; 32],
}

enum Phase {
    Idle,
    Checking,
    UpToDate,
    Available(Candidate),
    Downloading(Candidate),
    Verified(Verified),
    Closing { id: String, version: String },
    Installing { version: String },
    Failed { code: ErrorCode, trace: String },
    Stopped { trace: String },
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum DownloadStop {
    Continue,
    Cancelled,
    TooLarge,
}
struct ActiveDownload {
    id: String,
    stop: tokio::sync::watch::Sender<DownloadStop>,
}

pub struct Updater {
    driver: Option<Arc<dyn UpdateDriver>>,
    scratch: PathBuf,
    state: Mutex<Phase>,
    download: Mutex<Option<ActiveDownload>>,
}

pub struct InstallPlan {
    verified: Verified,
}

/// IPC future 被取消时也释放检查/下载占用；析构不恢复中毒锁，后续入口继续返回内部错误。
struct PendingUpdate<'a> {
    updater: &'a Updater,
    armed: bool,
}

impl Drop for PendingUpdate<'_> {
    fn drop(&mut self) {
        if !self.armed {
            return;
        }
        let Ok(mut state) = self.updater.state.lock() else {
            return;
        };
        let Ok(mut active) = self.updater.download.lock() else {
            return;
        };
        match std::mem::replace(&mut *state, Phase::Idle) {
            Phase::Checking => (),
            Phase::Downloading(candidate) => {
                active.take();
                *state = Phase::Available(candidate);
            }
            phase => *state = phase,
        }
    }
}

impl Updater {
    /// release.json=null 时宿主不加载插件并传入 None；无网络、无 scratch、状态为未配置。
    pub fn new(driver: Option<Arc<dyn UpdateDriver>>, scratch: PathBuf) -> Self {
        Self {
            driver,
            scratch,
            state: Mutex::new(Phase::Idle),
            download: Mutex::new(None),
        }
    }

    pub fn configured(&self) -> bool {
        self.driver.is_some()
    }

    pub fn update_settings(
        &self,
        config: &Mutex<LoadedConfig>,
        root: &Path,
        change: &UpdaterSettingsChange,
    ) -> Result<(), AppError> {
        let mut config = lock(config)?;
        check_source(
            config.native_settings().check_on_start.source,
            "updater.check_on_start",
        )?;
        if change.check_on_start && !self.configured() {
            return Err(AppError::new(UNCONFIGURED));
        }
        config.update_native_settings(
            root,
            &NativeSettingsChange::Updater(UpdaterSettingsChange {
                check_on_start: change.check_on_start,
            }),
        )?;
        Ok(())
    }

    /// 宿主以 Normal execute 的活动身份调用；查询不联网。
    pub fn status(&self) -> Result<UpdateState, AppError> {
        if !self.configured() {
            return Ok(UpdateState::Unconfigured);
        }
        Ok(match &*lock(&self.state)? {
            Phase::Idle => UpdateState::Idle,
            Phase::Checking => UpdateState::Checking,
            Phase::UpToDate => UpdateState::UpToDate,
            Phase::Available(c) => UpdateState::Available {
                release: c.release.clone(),
            },
            Phase::Downloading(c) => UpdateState::Downloading {
                release: c.release.clone(),
            },
            Phase::Verified(v) => UpdateState::Verified {
                release: v.candidate.release.clone(),
            },
            Phase::Closing { version, .. } => UpdateState::Closing {
                version: version.clone(),
            },
            Phase::Installing { version } => UpdateState::Installing {
                version: version.clone(),
            },
            Phase::Failed { code, trace } => UpdateState::Failed {
                error: safe_error(*code, trace),
            },
            Phase::Stopped { trace } => UpdateState::StoppedAfterInstallFailure {
                error: safe_error(INSTALL_FAILED, trace),
            },
        })
    }

    pub fn installing(&self) -> Result<bool, AppError> {
        Ok(matches!(
            *lock(&self.state)?,
            Phase::Closing { .. } | Phase::Installing { .. }
        ))
    }

    pub async fn check(
        &self,
        owner: StreamOwner,
        proxy: impl FnOnce() -> Result<Arc<ProxySnapshot>, AppError> + Send,
        trace: &str,
    ) -> Result<UpdateState, AppError> {
        let driver = self
            .driver
            .as_ref()
            .ok_or_else(|| AppError::new(UNCONFIGURED))?;
        check_owner(&owner)?;
        {
            let mut state = lock(&self.state)?;
            if matches!(
                *state,
                Phase::Checking
                    | Phase::Downloading(_)
                    | Phase::Closing { .. }
                    | Phase::Installing { .. }
                    | Phase::Stopped { .. }
            ) {
                return Err(AppError::new(OPERATION_BUSY));
            }
            *state = Phase::Checking;
        }
        let mut pending = PendingUpdate {
            updater: self,
            armed: true,
        };
        let result = async {
            let proxy = proxy()?;
            let id = uuid::Uuid::new_v4().simple().to_string();
            let scratch = scratch(&self.scratch, &id)?;
            let info = driver.check(proxy, scratch.path().to_owned()).await?;
            Ok::<_, AppError>(info.map(|info| Candidate {
                release: UpdateRelease {
                    update_id: id,
                    version: info.version,
                    published_at: info.published_at,
                    notes: info.notes,
                    bytes: None,
                },
                owner,
                scratch,
            }))
        }
        .await;
        let mut state = lock(&self.state)?;
        pending.armed = false;
        *state = match result {
            Ok(Some(candidate)) => Phase::Available(candidate),
            Ok(None) => Phase::UpToDate,
            Err(error) => {
                *state = Phase::Failed {
                    code: error.code(),
                    trace: trace.into(),
                };
                return Err(AppError::new(error.code()));
            }
        };
        drop(state);
        self.status()
    }

    pub async fn download(
        &self,
        owner: StreamOwner,
        input: UpdateDownloadInput,
        stream: Arc<Stream<OperationProgress>>,
        trace: &str,
    ) -> Result<UpdateState, AppError> {
        let driver = self
            .driver
            .as_ref()
            .ok_or_else(|| AppError::new(UNCONFIGURED))?;
        let id = uuid::Uuid::new_v4().simple().to_string();
        let (stop, mut stopped) = tokio::sync::watch::channel(DownloadStop::Continue);
        {
            let mut state = lock(&self.state)?;
            let Phase::Available(candidate) = &*state else {
                return Err(AppError::new(INVALID_RELEASE));
            };
            check_candidate(candidate, &owner, &input.update_id)?;
            let mut active = lock(&self.download)?;
            if active.is_some() {
                return Err(AppError::new(OPERATION_BUSY));
            }
            *active = Some(ActiveDownload {
                id: id.clone(),
                stop: stop.clone(),
            });
            if let Phase::Available(candidate) = std::mem::replace(&mut *state, Phase::Idle) {
                *state = Phase::Downloading(candidate);
            }
        }
        let mut pending = PendingUpdate {
            updater: self,
            armed: true,
        };
        let _ = stream.delta(progress(&id, OperationPhase::Downloading, 0, None, true));
        let observer = stream.clone();
        let progress_id = id.clone();
        let started = Instant::now();
        let count = AtomicU64::new(0);
        let last = AtomicU64::new(0);
        let report: DownloadProgress = Arc::new(move |length, total| {
            let previous = count
                .fetch_update(Ordering::SeqCst, Ordering::SeqCst, |n| {
                    Some(n.saturating_add(length as u64))
                })
                .unwrap_or_else(|n| n);
            let current = previous.saturating_add(length as u64);
            if current > DOWNLOAD_LIMIT || total.is_some_and(|total| total > DOWNLOAD_LIMIT) {
                stop.send_replace(DownloadStop::TooLarge);
                return;
            }
            let elapsed = started.elapsed().as_millis() as u64;
            if elapsed.saturating_sub(last.load(Ordering::Relaxed)) >= 100 {
                last.store(elapsed, Ordering::Relaxed);
                let _ = observer.delta(progress(
                    &progress_id,
                    OperationPhase::Downloading,
                    current,
                    total,
                    true,
                ));
            }
        });
        let result = tokio::select! {
            biased;
            _ = stopped.changed() => None,
            result = driver.download(report) => Some(result),
        };
        let mut state = lock(&self.state)?;
        let active = lock(&self.download)?
            .take()
            .ok_or_else(|| AppError::new(INVALID_RELEASE))?;
        pending.armed = false;
        let stop = *active.stop.borrow();
        let Phase::Downloading(mut candidate) = std::mem::replace(&mut *state, Phase::Idle) else {
            return Err(AppError::new(INVALID_RELEASE));
        };
        if stop == DownloadStop::Cancelled {
            *state = Phase::Available(candidate);
        } else {
            let result = if stop == DownloadStop::TooLarge {
                Err(AppError::new(DOWNLOAD_TOO_LARGE))
            } else {
                result.ok_or_else(|| AppError::new(DOWNLOAD_FAILED))?
            };
            match result.and_then(|bytes| {
                if bytes.len() as u64 > DOWNLOAD_LIMIT {
                    Err(AppError::new(DOWNLOAD_TOO_LARGE))
                } else {
                    Ok(bytes)
                }
            }) {
                Ok(bytes) => {
                    let length = bytes.len() as u64;
                    candidate.release.bytes = Some(length);
                    let digest = Sha256::digest(&bytes).into();
                    *state = Phase::Verified(Verified {
                        candidate,
                        bytes,
                        digest,
                    });
                    let _ = stream.delta(progress(
                        &id,
                        OperationPhase::Ready,
                        length,
                        Some(length),
                        false,
                    ));
                }
                Err(error) => {
                    *state = Phase::Failed {
                        code: error.code(),
                        trace: trace.into(),
                    };
                    return Err(AppError::new(error.code()));
                }
            }
        }
        drop(state);
        self.status()
    }

    /// 无身份 Control：只有发起流获得随机令牌；未知、其他操作和完成令牌均为空操作。
    pub fn cancel(&self, id: &str) -> Result<(), AppError> {
        if let Some(active) = lock(&self.download)?.as_ref()
            && active.id == id
        {
            active.stop.send_if_modified(|value| {
                if *value == DownloadStop::Continue {
                    *value = DownloadStop::Cancelled;
                    true
                } else {
                    false
                }
            });
        }
        Ok(())
    }

    pub fn prepare_install(
        &self,
        owner: StreamOwner,
        input: UpdateInstallInput,
    ) -> Result<InstallPlan, AppError> {
        if !self.configured() {
            return Err(AppError::new(UNCONFIGURED));
        }
        let mut state = lock(&self.state)?;
        let Phase::Verified(verified) = &*state else {
            return Err(AppError::new(INVALID_RELEASE));
        };
        check_candidate(&verified.candidate, &owner, &input.update_id)?;
        let digest: [u8; 32] = Sha256::digest(&verified.bytes).into();
        if digest != verified.digest {
            return Err(AppError::new(SIGNATURE_INVALID));
        }
        let closing = Phase::Closing {
            id: input.update_id,
            version: verified.candidate.release.version.clone(),
        };
        let Phase::Verified(verified) = std::mem::replace(&mut *state, closing) else {
            return Err(AppError::new(INVALID_RELEASE));
        };
        Ok(InstallPlan { verified })
    }

    /// 阻塞工作线程调用；先等待共同退出顺序，再调用安装器。失败只返回安全错误并保持停机。
    pub fn install(
        &self,
        plan: InstallPlan,
        before_exit: BeforeExit,
        trace: &str,
    ) -> Result<(), IpcError> {
        let invalid = || safe_error(INVALID_RELEASE, trace);
        let driver = self.driver.as_ref().ok_or_else(invalid)?;
        {
            let state = lock(&self.state).map_err(|e| safe_error(e.code(), trace))?;
            if !matches!(&*state, Phase::Closing { id, .. } if id == &plan.verified.candidate.release.update_id)
            {
                return Err(invalid());
            }
        }
        before_exit();
        *lock(&self.state).map_err(|e| safe_error(e.code(), trace))? = Phase::Installing {
            version: plan.verified.candidate.release.version.clone(),
        };
        // 保留安装/原子交换恢复证据；宿主按其平台安装结果清理或留存。
        let directory = plan.verified.candidate.scratch.keep();
        if driver.install(plan.verified.bytes).is_err() {
            *lock(&self.state).map_err(|e| safe_error(e.code(), trace))? = Phase::Stopped {
                trace: trace.into(),
            };
            if std::fs::write(
                directory.join("install-result.json"),
                br#"{"code":"app.update.install_failed"}"#,
            )
            .is_err()
            {
                return Err(IpcError {
                    code: INSTALL_FAILED.as_str().into(),
                    params: [("evidence".into(), "unavailable".into())].into(),
                    trace_id: trace.into(),
                });
            }
            return Err(safe_error(INSTALL_FAILED, trace));
        }
        Ok(())
    }
}

fn check_owner(owner: &StreamOwner) -> Result<(), AppError> {
    if owner.scope != "main" || matches!(owner.actor, Actor::System) {
        return Err(AppError::new(PERMISSION_DENIED));
    }
    Ok(())
}

fn check_candidate(candidate: &Candidate, owner: &StreamOwner, id: &str) -> Result<(), AppError> {
    if candidate.release.update_id != id || &candidate.owner != owner {
        return Err(AppError::new(INVALID_RELEASE));
    }
    Ok(())
}

fn progress(
    id: &str,
    phase: OperationPhase,
    current: u64,
    total: Option<u64>,
    can_cancel: bool,
) -> OperationProgress {
    OperationProgress {
        operation_id: id.into(),
        phase,
        current: Some(current),
        total,
        unit: OperationUnit::Bytes,
        can_cancel,
    }
}

pub fn safe_error(code: ErrorCode, trace: &str) -> IpcError {
    IpcError {
        code: code.as_str().into(),
        params: Default::default(),
        trace_id: trace.into(),
    }
}
fn scratch(root: &Path, id: &str) -> Result<tempfile::TempDir, AppError> {
    // The host injects its explicit Temp directory; IPC cannot select this path.
    // Validate every existing component, including state-root ancestors, without relying on cwd.
    if !root.is_absolute() {
        return Err(AppError::new(INVALID_RELEASE));
    }
    let mut directory = PathBuf::new();
    for component in root.components() {
        if matches!(
            component,
            std::path::Component::Prefix(_) | std::path::Component::RootDir
        ) {
            directory.push(component);
            continue;
        }
        let std::path::Component::Normal(component) = component else {
            return Err(AppError::new(INVALID_RELEASE));
        };
        directory.push(component);
        match std::fs::create_dir(&directory) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {}
            Err(_) => return Err(AppError::new(INVALID_RELEASE)),
        }
        let metadata =
            std::fs::symlink_metadata(&directory).map_err(|_| AppError::new(INVALID_RELEASE))?;
        let ordinary = metadata.is_dir() && !metadata.file_type().is_symlink();
        #[cfg(windows)]
        let ordinary = {
            use std::os::windows::fs::MetadataExt;
            ordinary && metadata.file_attributes() & 0x400 == 0
        };
        if !ordinary {
            return Err(AppError::new(INVALID_RELEASE));
        }
    }
    tempfile::Builder::new()
        .prefix(&format!("{id}-"))
        .tempdir_in(directory)
        .map_err(|_| AppError::new(INVALID_RELEASE))
}

#[cfg(test)]
mod tests;
