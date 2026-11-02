use std::{
    path::Path,
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    },
};
use tenon_desktop::{
    native::{exit::ExitController, instance::MainWindowIntent},
    startup_recovery::{self, StartupRecovery},
};
use tenon_framework::{
    bootstrap::Started,
    error::{AppError, INTERNAL_UNEXPECTED},
    maintenance::OperationGate,
};

pub(crate) struct Lifecycle {
    pub gate: OperationGate,
    pub window: MainWindowIntent,
    pub exit: ExitController,
    recovery: Mutex<StartupRecovery>,
    // 事件循环从启动前就存在，关闭栈仅在全部阶段成功后移交。
    started: Mutex<Option<Arc<Started>>>,
    failed: AtomicBool,
}

impl Lifecycle {
    pub fn new() -> Self {
        let gate = OperationGate::default();
        Self {
            window: MainWindowIntent::new(gate.clone()),
            exit: ExitController::new(gate.clone()),
            gate,
            recovery: Mutex::new(StartupRecovery::default()),
            started: Mutex::new(None),
            failed: AtomicBool::new(false),
        }
    }

    pub fn install(&self, started: Arc<Started>) -> Result<(), AppError> {
        let mut current = self
            .started
            .lock()
            .map_err(|_| AppError::new(INTERNAL_UNEXPECTED))?;
        if current.is_some() {
            return Err(AppError::new(INTERNAL_UNEXPECTED));
        }
        *current = Some(started);
        Ok(())
    }

    pub fn begin_record(&self, root: &Path) -> Result<(), AppError> {
        let mut recovery = self
            .recovery
            .lock()
            .map_err(|_| AppError::new(INTERNAL_UNEXPECTED))?;
        if let Err(error) = recovery.begin_record(root, &root.join("Temp/startup-recovery")) {
            tracing::warn!(code = %error.code(), "启动记录不可用，保留原记录");
        }
        Ok(())
    }

    pub fn notice_json(&self) -> Result<String, AppError> {
        self.recovery
            .lock()
            .map_err(|_| AppError::new(INTERNAL_UNEXPECTED))?
            .notice_json()
    }

    pub fn fail(&self, error: &AppError) {
        self.failed.store(true, Ordering::Release);
        self.exit.begin();
        match self.recovery.lock() {
            Ok(mut recovery) => {
                if let Err(error) = recovery.record_failure(startup_recovery::failure_notice(error))
                {
                    tracing::warn!(code = %error.code(), "启动失败记录未写入");
                }
            }
            Err(_) => tracing::error!(reason_code = "startup_record_lock", "启动失败记录未写入"),
        }
    }

    pub fn exit_code(&self) -> i32 {
        i32::from(self.failed.load(Ordering::Acquire))
    }

    pub async fn shutdown(&self) {
        self.exit.begin();
        let started = match self.started.lock() {
            Ok(current) => current.clone(),
            Err(poisoned) => {
                // 中毒不能遗失已获得的关闭所有权；继续释放并明确记错。
                tracing::error!(reason_code = "shutdown_lock", "关闭句柄锁中毒");
                poisoned.into_inner().clone()
            }
        };
        if let Some(started) = started {
            started.shutdown().await;
        }
        match self.recovery.lock() {
            Ok(mut recovery) => {
                if let Err(error) = recovery.finish_record() {
                    tracing::warn!(code = %error.code(), "结束记录未写入");
                }
            }
            Err(_) => tracing::error!(reason_code = "startup_record_lock", "结束记录未写入"),
        }
    }
}
