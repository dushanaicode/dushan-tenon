//! 准入永久关闭与串行退出；宿主提供取消流、停原生事件/jobs、排空、模块、数据库和日志的完整收尾。

use std::{
    future::Future,
    sync::atomic::{AtomicBool, Ordering},
};

use tenon_framework::maintenance::OperationGate;
use tokio::sync::Mutex;

pub struct ExitController {
    gate: OperationGate,
    shutdown: Mutex<()>,
    finished: AtomicBool,
}

impl ExitController {
    pub fn new(gate: OperationGate) -> Self {
        Self {
            gate,
            shutdown: Mutex::new(()),
            finished: AtomicBool::new(false),
        }
    }

    pub fn begin(&self) {
        self.gate.close_admission();
    }

    pub fn is_finished(&self) -> bool {
        self.finished.load(Ordering::Acquire)
    }

    /// 原生回调只发起此异步流程，不能阻塞事件线程。只有首次完成者负责退出进程。
    pub async fn request_exit(&self, shutdown: impl Future<Output = ()>) -> bool {
        self.begin();
        let _serial = self.shutdown.lock().await;
        if self.is_finished() {
            return false;
        }
        shutdown.await;
        self.finished.store(true, Ordering::Release);
        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        sync::{Arc, Mutex},
        time::Duration,
    };
    use tenon_framework::maintenance::LIFECYCLE_CLOSING;

    #[tokio::test]
    async fn exit_waits_once_and_denies_admission() {
        let gate = OperationGate::default();
        let permit = gate.enter().unwrap();
        let controller = ExitController::new(gate.clone());
        let events = Arc::new(Mutex::new(Vec::new()));
        let first = controller.request_exit(async {
            events
                .lock()
                .unwrap()
                .extend(["streams", "windows", "native", "jobs"]);
            gate.close().await;
            events
                .lock()
                .unwrap()
                .extend(["modules", "database", "logs"]);
        });
        tokio::pin!(first);
        assert!(
            tokio::time::timeout(Duration::from_millis(10), &mut first)
                .await
                .is_err()
        );
        assert_eq!(gate.enter().err().unwrap().code(), LIFECYCLE_CLOSING);
        assert!(!controller.is_finished());
        let second = controller.request_exit(async {
            panic!("duplicate shutdown");
        });
        tokio::pin!(second);
        assert!(
            tokio::time::timeout(Duration::from_millis(10), &mut second)
                .await
                .is_err()
        );
        assert_eq!(
            *events.lock().unwrap(),
            ["streams", "windows", "native", "jobs"]
        );
        drop(permit);
        let (first, second) = tokio::join!(first, second);
        assert!(first && !second && controller.is_finished());
        assert_eq!(
            *events.lock().unwrap(),
            [
                "streams", "windows", "native", "jobs", "modules", "database", "logs"
            ]
        );
    }

    #[tokio::test]
    async fn tray_exit_uses_shared_shutdown() {
        use crate::native::tray::TrayAction;
        let controller = ExitController::new(OperationGate::default());
        let requested = std::cell::Cell::new(false);
        TrayAction::from_menu("tray.exit")
            .unwrap()
            .dispatch(|| panic!("exit cannot show"), || requested.set(true));
        assert!(requested.get());
        let (first, second) = tokio::join!(
            controller.request_exit(async {}),
            controller.request_exit(async { panic!("duplicate shutdown") })
        );
        assert!(first && !second);
        let shown = std::cell::Cell::new(0);
        TrayAction::Show.dispatch(|| shown.set(shown.get() + 1), || panic!("show cannot exit"));
        TrayAction::from_menu("tray.show")
            .unwrap()
            .dispatch(|| shown.set(shown.get() + 1), || panic!("show cannot exit"));
        assert_eq!(shown.get(), 2);
        assert!(TrayAction::from_menu("unknown").is_none());
    }
}
