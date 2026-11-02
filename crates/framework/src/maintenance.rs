//! 操作准入、维护独占与关闭排空；维护释放后重开，关闭永久拒绝新操作，仅依赖 error。

use std::sync::{
    Arc,
    atomic::{AtomicBool, Ordering},
};

use tokio::sync::{Mutex, OwnedMutexGuard, OwnedRwLockReadGuard, OwnedRwLockWriteGuard, RwLock};

use crate::error::{AppError, ErrorCode};

pub const LIFECYCLE_CLOSING: ErrorCode = ErrorCode::new("app.lifecycle.closing");
pub const OPERATION_BUSY: ErrorCode = ErrorCode::new("app.operation.busy");

/// 命令清单决定准入；维护与控制只允许宿主的有限名单。
#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub enum CommandAdmission {
    Normal,
    Maintenance,
    Control,
}

#[derive(Clone, Default)]
pub struct OperationGate {
    closing: Arc<AtomicBool>,
    operations: Arc<RwLock<()>>,
    maintenance: Arc<Mutex<()>>,
}

/// 领取任务时转交同一许可，不能在已经持有许可时重新申请（维护可能正在排队）。
#[derive(Clone)]
#[must_use]
pub struct OperationPermit {
    _guard: Arc<OwnedRwLockReadGuard<()>>,
}

#[must_use]
pub struct Quiescence {
    _operations: OwnedRwLockWriteGuard<()>,
    _maintenance: OwnedMutexGuard<()>,
}

impl OperationGate {
    pub fn enter(&self) -> Result<OperationPermit, AppError> {
        self.check_open()?;
        let guard = self
            .operations
            .clone()
            .try_read_owned()
            .map_err(|_| self.unavailable())?;
        self.check_open()?;
        Ok(OperationPermit {
            _guard: Arc::new(guard),
        })
    }

    /// 控制通道只访问内存，不占共享许可，也不参与关闭排空。
    pub fn enter_control(&self) -> Result<(), AppError> {
        self.check_open()
    }

    /// 调用者必须先释放自己的共享许可；作用域结束或取消等待都会释放维护请求。
    pub async fn quiesce(&self) -> Result<Quiescence, AppError> {
        self.check_open()?;
        let maintenance = self
            .maintenance
            .clone()
            .try_lock_owned()
            .map_err(|_| self.unavailable())?;
        let operations = self.operations.clone().write_owned().await;
        self.check_open()?;
        Ok(Quiescence {
            _operations: operations,
            _maintenance: maintenance,
        })
    }

    /// 先关闭接入，再取消流和停止执行器；不能在取消工作之前等待排空。
    pub fn close_admission(&self) {
        self.closing.store(true, Ordering::Release);
    }

    /// 永久关闭并等待在途许可和维护作用域全部释放；并发调用都等待实际排空。
    pub async fn close(&self) {
        self.close_admission();
        let _drained = self.operations.write().await;
    }

    pub fn is_closing(&self) -> bool {
        self.closing.load(Ordering::Acquire)
    }

    fn check_open(&self) -> Result<(), AppError> {
        if self.is_closing() {
            Err(AppError::new(LIFECYCLE_CLOSING))
        } else {
            Ok(())
        }
    }

    fn unavailable(&self) -> AppError {
        AppError::new(if self.is_closing() {
            LIFECYCLE_CLOSING
        } else {
            OPERATION_BUSY
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;
    use tokio::time::timeout;

    #[tokio::test]
    async fn exit_waits_once_and_denies_admission() {
        let gate = OperationGate::default();
        let permit = gate.enter().unwrap();
        let transferred = permit.clone();
        let close = gate.close();
        tokio::pin!(close);
        assert!(
            timeout(Duration::from_millis(10), &mut close)
                .await
                .is_err()
        );
        assert_eq!(gate.enter().err().unwrap().code(), LIFECYCLE_CLOSING);
        let second = gate.close();
        tokio::pin!(second);
        assert!(
            timeout(Duration::from_millis(10), &mut second)
                .await
                .is_err()
        );
        drop(permit);
        assert!(
            timeout(Duration::from_millis(10), &mut close)
                .await
                .is_err()
        );
        drop(transferred);
        timeout(Duration::from_secs(1), async {
            tokio::join!(close, second)
        })
        .await
        .unwrap();
        assert_eq!(
            gate.quiesce().await.err().unwrap().code(),
            LIFECYCLE_CLOSING
        );
        assert_eq!(gate.enter().err().unwrap().code(), LIFECYCLE_CLOSING);
    }

    #[tokio::test]
    async fn quiesce_waits_reopens_and_cannot_reopen_close() {
        let gate = OperationGate::default();
        let permit = gate.enter().unwrap();
        let quiesce = gate.quiesce();
        tokio::pin!(quiesce);
        assert!(
            timeout(Duration::from_millis(10), &mut quiesce)
                .await
                .is_err()
        );
        assert_eq!(gate.enter().err().unwrap().code(), OPERATION_BUSY);
        assert_eq!(gate.quiesce().await.err().unwrap().code(), OPERATION_BUSY);
        drop(permit);
        let exclusive = quiesce.await.unwrap();
        assert_eq!(gate.enter().err().unwrap().code(), OPERATION_BUSY);
        drop(exclusive);
        drop(gate.enter().unwrap());
        let exclusive = gate.quiesce().await.unwrap();
        let close = gate.close();
        tokio::pin!(close);
        assert!(
            timeout(Duration::from_millis(10), &mut close)
                .await
                .is_err()
        );
        drop(exclusive);
        close.await;
        assert_eq!(gate.enter().err().unwrap().code(), LIFECYCLE_CLOSING);
    }
}
