//! 类型化启动值由宿主持有；内核只记录步骤耗时和成功资源的有名关闭栈。
//! 失败阶段自行释放半成品，调用方显式等待 rollback，不依靠 Drop 执行异步清理。

use std::{future::Future, pin::Pin, time::Instant};

use tokio::sync::Mutex;

use crate::error::AppError;

type CloseFuture = Pin<Box<dyn Future<Output = Result<(), AppError>> + Send>>;

struct CloseAction {
    name: &'static str,
    close: Box<dyn FnOnce() -> CloseFuture + Send>,
}

/// 记录一个具体产物的构造；不限制各阶段返回相同类型。
pub async fn step<T>(
    name: &'static str,
    action: impl Future<Output = Result<T, AppError>>,
) -> Result<T, AppError> {
    timed(name, "open", action).await
}

async fn timed<T>(
    name: &'static str,
    phase: &'static str,
    action: impl Future<Output = Result<T, AppError>>,
) -> Result<T, AppError> {
    let started = Instant::now();
    let result = action.await;
    let elapsed_ms = started.elapsed().as_millis();
    match &result {
        Ok(_) => tracing::info!(step = name, phase, elapsed_ms, "启动步骤完成"),
        Err(error) => {
            tracing::error!(step = name, phase, elapsed_ms, code = %error.code(), "启动步骤失败");
        }
    }
    result
}

/// 获得资源后立即登记捕获实际句柄的动作；关闭顺序是登记顺序的逆序。
#[derive(Default)]
pub struct ShutdownStack {
    actions: Vec<CloseAction>,
}

impl ShutdownStack {
    pub fn push<F: Future<Output = Result<(), AppError>> + Send + 'static>(
        &mut self,
        name: &'static str,
        close: impl FnOnce() -> F + Send + 'static,
    ) {
        self.actions.push(CloseAction {
            name,
            close: Box::new(move || Box::pin(close())),
        });
    }

    /// 必须显式等待。关闭失败只记日志，不能覆盖调用方保留的启动错误。
    pub async fn rollback(self) {
        close_all(self.actions).await;
    }

    pub fn into_started(self) -> Started {
        Started {
            actions: Mutex::new(Some(self.actions)),
        }
    }
}

/// 与运行状态分离的一次性关闭所有权；所有调用者等待同一次收尾。
pub struct Started {
    actions: Mutex<Option<Vec<CloseAction>>>,
}

impl Started {
    pub async fn shutdown(&self) {
        // 持锁至全部动作完成，不能在 take 后提前放行并发调用者。
        let mut actions = self.actions.lock().await;
        if let Some(actions) = actions.take() {
            close_all(actions).await;
        }
    }
}

async fn close_all(actions: Vec<CloseAction>) {
    for action in actions.into_iter().rev() {
        let _ = timed(action.name, "close", (action.close)()).await;
    }
}

#[cfg(test)]
mod tests;
