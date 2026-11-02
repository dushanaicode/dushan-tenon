//! 宿主声明步骤与类型明确的资源集合，内核负责启动及共享收尾，仅依赖 error。
//!
//! 关闭顺序就是成功步骤栈的逆序；“先关入口、再排空、再释放资源”由步骤排列表达。
//! 同一个可等待的 [`Started::shutdown`] 服务正常退出和更新器的退出前钩子。

use std::{future::Future, pin::Pin, time::Instant};

use tokio::sync::Mutex;

use crate::error::AppError;

pub type StepFuture<'a> = Pin<Box<dyn Future<Output = Result<(), AppError>> + Send + 'a>>;
type Action<R> = Box<dyn for<'a> Fn(&'a mut R) -> StepFuture<'a> + Send + Sync>;

/// 一个启动步骤；`R` 是宿主定义的资源集合，不是任意类型容器。
/// 只有 open 成功才入栈；失败步骤必须在 open 内自行释放半启动的资源。
pub struct Step<R> {
    pub name: &'static str,
    open: Action<R>,
    close: Action<R>,
}

impl<R> Step<R> {
    pub fn new(
        name: &'static str,
        open: impl for<'a> Fn(&'a mut R) -> StepFuture<'a> + Send + Sync + 'static,
        close: impl for<'a> Fn(&'a mut R) -> StepFuture<'a> + Send + Sync + 'static,
    ) -> Self {
        Self {
            name,
            open: Box::new(open),
            close: Box::new(close),
        }
    }

    /// 没有需要释放的资源时使用；close 为空操作。
    pub fn open_only(
        name: &'static str,
        open: impl for<'a> Fn(&'a mut R) -> StepFuture<'a> + Send + Sync + 'static,
    ) -> Self {
        Self::new(name, open, |_| Box::pin(async { Ok(()) }))
    }

    async fn run(
        &self,
        resources: &mut R,
        phase: &'static str,
        action: &Action<R>,
    ) -> Result<(), AppError> {
        let started = Instant::now();
        let result = action(resources).await;
        let elapsed_ms = started.elapsed().as_millis();
        match &result {
            Ok(()) => tracing::info!(step = self.name, phase, elapsed_ms, "启动步骤完成"),
            Err(error) => {
                tracing::error!(step = self.name, phase, elapsed_ms, code = %error.code(), "启动步骤失败")
            }
        }
        result
    }
}

pub struct Pipeline<R> {
    steps: Vec<Step<R>>,
}

impl<R: Send + 'static> Pipeline<R> {
    pub fn new(steps: Vec<Step<R>>) -> Self {
        Self { steps }
    }

    /// 依次 open；失败时逆序 close 已成功步骤，清理错误不覆盖最初的启动错误。
    pub async fn start(self, mut resources: R) -> Result<Started<R>, AppError> {
        let mut opened = Vec::new();
        for step in self.steps {
            if let Err(error) = step.run(&mut resources, "open", &step.open).await {
                close_all(&mut resources, opened).await;
                return Err(error);
            }
            opened.push(step);
        }
        Ok(Started {
            state: Mutex::new(Some((resources, opened))),
        })
    }
}

/// 启动成功的资源与步骤栈；宿主将其托管至退出。
pub struct Started<R> {
    state: Mutex<Option<(R, Vec<Step<R>>)>>,
}

impl<R: Send + 'static> Started<R> {
    /// 幂等、共享且可等待。并发及后续调用等待同一次逆序收尾，不重复 close。
    /// 单步关闭失败已记录错误码，仍继续关闭其余步骤。
    pub async fn shutdown(&self) {
        // 锁持续持有至所有 close 完成，不能在取出状态后提前释放。
        let mut state = self.state.lock().await;
        if let Some((mut resources, steps)) = state.take() {
            close_all(&mut resources, steps).await;
        }
    }
}

async fn close_all<R>(resources: &mut R, steps: Vec<Step<R>>) {
    for step in steps.into_iter().rev() {
        let _ = step.run(resources, "close", &step.close).await;
    }
}

#[cfg(test)]
mod tests;
