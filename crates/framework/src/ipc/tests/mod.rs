mod admission;
mod errors;
mod identity;
mod logging;

use std::{
    io,
    pin::pin,
    sync::{Arc, Mutex},
    task::{Context, Poll, Waker},
};

use super::*;
use crate::{
    error::{INPUT_INVALID, MODULE_DISABLED},
    id::Id,
};

struct TestContext {
    gate: crate::maintenance::OperationGate,
    auth_pause: Option<Arc<Pause>>,
    value: i32,
    actor: Id,
    permissions: Vec<String>,
    checked: Mutex<Vec<String>>,
    resolved: std::sync::atomic::AtomicUsize,
    auth_error: std::sync::atomic::AtomicBool,
    permission_denied: std::sync::atomic::AtomicBool,
}

fn test_context(value: i32) -> TestContext {
    TestContext {
        gate: crate::maintenance::OperationGate::default(),
        auth_pause: None,
        value,
        actor: Id::new(),
        permissions: vec!["app.test.allowed".into()],
        checked: Mutex::new(Vec::new()),
        resolved: std::sync::atomic::AtomicUsize::new(0),
        auth_error: std::sync::atomic::AtomicBool::new(false),
        permission_denied: std::sync::atomic::AtomicBool::new(false),
    }
}

impl ActorResolver for TestContext {
    fn resolve_active(
        &self,
    ) -> Pin<Box<dyn Future<Output = Result<ActiveActor, AppError>> + Send + '_>> {
        Box::pin(async {
            self.resolved
                .fetch_add(1, std::sync::atomic::Ordering::Relaxed);
            if let Some(pause) = &self.auth_pause {
                pause.wait().await;
            }
            if self.auth_error.load(std::sync::atomic::Ordering::Relaxed) {
                return Err(AppError::new(crate::error::PERMISSION_DENIED));
            }
            Ok(ActiveActor {
                actor: Actor::User(self.actor),
                permissions: self.permissions.clone(),
            })
        })
    }
    fn resolve_session(
        &self,
    ) -> Pin<Box<dyn Future<Output = Result<Actor, AppError>> + Send + '_>> {
        Box::pin(async {
            self.resolved
                .fetch_add(10, std::sync::atomic::Ordering::Relaxed);
            if let Some(pause) = &self.auth_pause {
                pause.wait().await;
            }
            if self.auth_error.load(std::sync::atomic::Ordering::Relaxed) {
                return Err(AppError::new(crate::error::PERMISSION_DENIED));
            }
            Ok(Actor::User(self.actor))
        })
    }
    fn resolve_public(
        &self,
    ) -> Pin<Box<dyn Future<Output = Result<Option<Actor>, AppError>> + Send + '_>> {
        Box::pin(async {
            self.resolved
                .fetch_add(100, std::sync::atomic::Ordering::Relaxed);
            if let Some(pause) = &self.auth_pause {
                pause.wait().await;
            }
            if self.auth_error.load(std::sync::atomic::Ordering::Relaxed) {
                return Err(AppError::new(crate::error::PERMISSION_DENIED));
            }
            Ok(None)
        })
    }
}

impl IpcContext for TestContext {
    fn admission(&self) -> &crate::maintenance::OperationGate {
        &self.gate
    }
    fn command_admission(&self, command: &str) -> crate::maintenance::CommandAdmission {
        match command {
            "app_maintenance" => CommandAdmission::Maintenance,
            "app_control" | "disabled_control" => CommandAdmission::Control,
            _ => CommandAdmission::Normal,
        }
    }
    fn guard_module(&self, command: &str) -> Result<(), AppError> {
        match command_module(command)? {
            "app" => Ok(()),
            "disabled" => Err(AppError::new(MODULE_DISABLED).with_param("module", "disabled")),
            _ => Err(AppError::new(INTERNAL_UNEXPECTED)),
        }
    }
    fn actor_resolver(&self) -> &dyn ActorResolver {
        self
    }
    fn permission_checker(&self) -> &dyn PermissionChecker {
        self
    }
    fn required_permissions(&self, command: &str) -> Vec<&'static str> {
        match command {
            "app_test_allowed" | "app_maintenance" => vec!["app.test.allowed"],
            "app_test_denied" | "disabled_test_denied" => vec!["app.test.denied"],
            "app_test_multiple" => vec!["app.test.allowed", "app.test.second"],
            _ => vec![],
        }
    }
}

fn run_async_ipc_test(test: impl Future<Output = ()>) {
    // 与既有同步 IPC 用例共用锁，避免并发初始化 tracing callsite。
    let _guard = IPC_TEST_LOCK.lock().unwrap();
    tokio::runtime::Builder::new_current_thread()
        .enable_time()
        .build()
        .unwrap()
        .block_on(test);
}

#[derive(Default)]
struct Pause {
    entered: tokio::sync::Notify,
    resume: tokio::sync::Notify,
}

impl Pause {
    async fn wait(&self) {
        self.entered.notify_one();
        self.resume.notified().await;
    }
}

impl PermissionChecker for TestContext {
    fn check(&self, actor: &ActiveActor, key: &str) -> Result<(), AppError> {
        assert!(self.resolved.load(std::sync::atomic::Ordering::Relaxed) > 0);
        self.checked.lock().unwrap().push(key.into());
        if !self
            .permission_denied
            .load(std::sync::atomic::Ordering::Relaxed)
            && actor.permissions.iter().any(|permission| permission == key)
        {
            Ok(())
        } else {
            Err(AppError::new(crate::error::PERMISSION_DENIED).with_param("permission", key))
        }
    }
}

// 同一组 tracing callsite 在首次注册时不能与无 subscriber 的用例并发初始化。
static IPC_TEST_LOCK: Mutex<()> = Mutex::new(());

fn ready<T>(future: impl Future<Output = T>) -> T {
    match pin!(future).poll(&mut Context::from_waker(Waker::noop())) {
        Poll::Ready(value) => value,
        Poll::Pending => panic!("测试用例不应挂起"),
    }
}

#[derive(Clone)]
struct LogBuffer(Arc<Mutex<Vec<u8>>>);

impl io::Write for LogBuffer {
    fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
        self.0.lock().unwrap().extend_from_slice(bytes);
        Ok(bytes.len())
    }

    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}

fn must_not_run(message: &str) -> Result<(), AppError> {
    panic!("{message}")
}
