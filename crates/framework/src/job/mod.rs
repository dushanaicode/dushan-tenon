//! 持久队列与租约执行器；模块处理器不依赖宿主传输。
mod config;
pub use config::JobsConfig;
mod own;
mod watch;
pub use own::{INVALID_STATE, cancel_mine, changed, get_mine, require_mine, watch_mine};
pub use watch::watch;

mod runner;
mod schedule;
mod store;
mod types;
pub use runner::JobRunner;
pub use schedule::{ScheduleDeclaration, ScheduleError, ScheduleSnapshot};
pub use store::JobTarget;
pub use types::*;

use sea_query::ExprTrait;
use serde_json::Value;
use std::{
    collections::BTreeMap,
    future::Future,
    pin::Pin,
    sync::{Arc, Mutex},
};
use tokio::sync::{Notify, broadcast};
pub use tokio_util::sync::CancellationToken;

use crate::{
    actor::{Actor, ExecutionContext},
    db::{Db, Tx},
    dict::{DictDeclaration, valid_value},
    error::{AppError, INTERNAL_UNEXPECTED},
    instance::InstanceId,
};

pub type JobFuture<'a> = Pin<Box<dyn Future<Output = Result<Value, AppError>> + Send + 'a>>;

/// 只有提交成功才轮询此 future；回滚时直接丢弃，禁止在构造时产生外部副作用。
pub type AfterJobCommit = Pin<Box<dyn Future<Output = Result<(), AppError>> + Send>>;
pub type JobCompletionFuture<'a> =
    Pin<Box<dyn Future<Output = Result<Option<AfterJobCommit>, AppError>> + Send + 'a>>;

/// 完成钩子 0..N，零个合法；按模块依赖拓扑顺序、模块内声明顺序执行。
pub trait JobCompletionHook: Send + Sync {
    fn complete<'a>(
        &'a self,
        tx: &'a mut Tx<'_>,
        queue: &'a JobQueue,
        job: &'a JobSnapshot,
    ) -> JobCompletionFuture<'a>;
}

/// 声明的任务类型各有一个处理器；缺失、重复或未声明的类型均注册失败。
pub trait JobHandler: Send + Sync {
    fn kind(&self) -> &'static str;
    fn permissions(&self) -> &'static [&'static str];
    fn retry_safe(&self) -> bool;
    fn max_attempts(&self) -> i32;
    fn local_only(&self) -> bool {
        false
    }
    fn concurrency(&self) -> usize {
        1
    }
    fn run(&self, context: JobContext) -> JobFuture<'_>;
}

/// 后台权限查询扩展槽恰好一个已启用提供者；缺失或重复启动失败，不默认放行。
pub trait PermissionLookup: Send + Sync {
    fn has_permission<'a>(
        &'a self,
        actor: Actor,
        key: &'a str,
    ) -> Pin<Box<dyn Future<Output = Result<bool, AppError>> + Send + 'a>>;
}

pub struct JobContext {
    pub payload: Value,
    pub execution: ExecutionContext,
    pub db: Db,
    pub cancellation: CancellationToken,
    reporter: Arc<runner::ProgressReporter>,
    failure_result: Arc<Mutex<Option<Value>>>,
    #[cfg(any(test, feature = "test-support"))]
    progress_observer: Option<Box<dyn Fn(i64) + Send + Sync>>,
}

impl JobContext {
    pub fn id(&self) -> crate::id::Id {
        self.reporter.id()
    }

    pub fn set_failure_result(&self, value: Value) -> Result<(), AppError> {
        *self
            .failure_result
            .lock()
            .map_err(|_| AppError::new(INTERNAL_UNEXPECTED))? = Some(value);
        Ok(())
    }

    /// 写事务内只发布内存进度，结束后由执行器刷盘，避免 SQLite 自锁。
    pub async fn progress_in_transaction(
        &self,
        current: i64,
        total: i64,
        message_key: &str,
        params: BTreeMap<String, String>,
    ) -> Result<(), AppError> {
        let progress = JobProgress::new(current, total, message_key, params)?;
        #[cfg(any(test, feature = "test-support"))]
        if let Some(observer) = &self.progress_observer {
            observer(current);
        }
        self.reporter.buffer(progress).await;
        Ok(())
    }
    pub async fn progress(
        &self,
        current: i64,
        total: i64,
        message_key: &str,
        params: BTreeMap<String, String>,
    ) -> Result<(), AppError> {
        let progress = JobProgress::new(current, total, message_key, params)?;
        #[cfg(any(test, feature = "test-support"))]
        if let Some(observer) = &self.progress_observer {
            observer(current);
        }
        self.reporter.report(progress).await
    }
}

#[derive(Clone)]
pub struct JobQueue(Arc<QueueInner>);

struct QueueInner {
    db: Db,
    instance_id: InstanceId,
    handlers: BTreeMap<&'static str, RegisteredHandler>,
    schedules: BTreeMap<&'static str, RegisteredSchedule>,
    notify: Notify,
    events: broadcast::Sender<JobEvent>,
    completion_hooks: Vec<Arc<dyn JobCompletionHook>>,
    running: Mutex<BTreeMap<crate::id::Id, CancellationToken>>,
}

struct RegisteredHandler {
    module: &'static str,
    handler: Arc<dyn JobHandler>,
}

struct RegisteredSchedule {
    module: &'static str,
    declaration: ScheduleDeclaration,
}

fn declaration_module(kind: &'static str) -> Result<&'static str, AppError> {
    let (module, _) = kind
        .split_once('.')
        .ok_or_else(|| AppError::new(INTERNAL_UNEXPECTED))?;
    if !valid_value(module) || !valid_key(kind, module) {
        return Err(AppError::new(INTERNAL_UNEXPECTED));
    }
    Ok(module)
}

fn valid_key(key: &str, module: &str) -> bool {
    key.len() <= 128
        && key.split_once('.').is_some_and(|(prefix, name)| {
            prefix == module
                && !name.is_empty()
                && name
                    .bytes()
                    .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'_')
        })
}

pub const DICTIONARIES: &[DictDeclaration] = &[DictDeclaration {
    code: "framework.job_status",
    items: JobStatus::ITEMS,
}];

impl JobQueue {
    /// 明确注入可执行处理器、计划和有序完成钩子，不持有注册表。
    pub fn new(
        db: Db,
        handlers: Vec<Arc<dyn JobHandler>>,
        schedules: Vec<ScheduleDeclaration>,
        completion_hooks: Vec<Arc<dyn JobCompletionHook>>,
        instance_id: InstanceId,
    ) -> Result<Self, AppError> {
        let mut registered_handlers = BTreeMap::new();
        for handler in handlers {
            let kind = handler.kind();
            let module = declaration_module(kind)?;
            if handler.max_attempts() < 1
                || handler.concurrency() < 1
                || registered_handlers
                    .insert(kind, RegisteredHandler { module, handler })
                    .is_some()
            {
                return Err(AppError::new(INTERNAL_UNEXPECTED));
            }
        }
        let mut registered_schedules = BTreeMap::new();
        for declaration in schedules {
            let module = declaration_module(declaration.kind)?;
            if !valid_key(declaration.key, module)
                || registered_schedules
                    .insert(
                        declaration.key,
                        RegisteredSchedule {
                            module,
                            declaration,
                        },
                    )
                    .is_some()
            {
                return Err(AppError::new(INTERNAL_UNEXPECTED));
            }
        }
        Ok(Self(Arc::new(QueueInner {
            db,
            instance_id,
            handlers: registered_handlers,
            schedules: registered_schedules,
            completion_hooks,
            notify: Notify::new(),
            events: broadcast::channel(256).0,
            running: Mutex::new(BTreeMap::new()),
        })))
    }

    pub fn subscribe(&self) -> broadcast::Receiver<JobEvent> {
        self.0.events.subscribe()
    }
    pub fn wake(&self) {
        self.0.notify.notify_one();
    }
    fn broadcast(&self, event: JobEvent) {
        let _ = self.0.events.send(event);
    }

    async fn complete(
        &self,
        tx: &mut Tx<'_>,
        id: crate::id::Id,
    ) -> Result<Vec<AfterJobCommit>, AppError> {
        let job = tx
            .fetch_optional::<store::JobRecord>(
                &store::query()
                    .and_where(sea_query::Expr::col("id").eq(id))
                    .to_owned(),
            )
            .await?
            .ok_or_else(|| AppError::new(INTERNAL_UNEXPECTED))?
            .snapshot()?;
        let mut callbacks = Vec::new();
        if job.status.is_terminal() {
            for hook in &self.0.completion_hooks {
                if let Some(callback) = hook.complete(tx, self, &job).await? {
                    callbacks.push(callback);
                }
            }
        }
        Ok(callbacks)
    }

    async fn after_commit(
        &self,
        id: crate::id::Id,
        callbacks: Vec<AfterJobCommit>,
    ) -> Result<(), AppError> {
        for callback in callbacks {
            if let Err(error) = callback.await {
                tracing::error!(code = %error.code(), "任务提交后回调失败，保留投递记录供核对");
            }
        }
        self.publish(id).await
    }
}

#[cfg(any(test, feature = "test-support"))]
impl JobQueue {
    /// 合同测试以真实领取构造上下文，不替换数据库或进度实现。
    pub async fn test_context(
        &self,
        id: crate::id::Id,
        cancellation: CancellationToken,
    ) -> Result<JobContext, AppError> {
        let owner = uuid::Uuid::new_v4().to_string();
        let leased = self
            .claim(id, &owner, crate::time::Timestamp::now(), 30)
            .await?
            .ok_or_else(|| AppError::new(INTERNAL_UNEXPECTED))?;
        let job = &leased.snapshot;
        Ok(JobContext {
            payload: job.payload.clone(),
            execution: ExecutionContext::new(
                job.submitted_by.map_or(Actor::System, Actor::User),
                "job-test",
            ),
            db: self.0.db.clone(),
            cancellation: cancellation.clone(),
            failure_result: Arc::new(Mutex::new(None)),
            reporter: Arc::new(runner::ProgressReporter::new(
                self.clone(),
                leased,
                cancellation,
            )),
            progress_observer: None,
        })
    }

    /// 在 progress 返回前同步观察进度，让批次边界的取消不依赖广播接收时序。
    pub async fn test_context_with_progress_observer(
        &self,
        id: crate::id::Id,
        cancellation: CancellationToken,
        observer: impl Fn(i64) + Send + Sync + 'static,
    ) -> Result<JobContext, AppError> {
        let mut context = self.test_context(id, cancellation).await?;
        context.progress_observer = Some(Box::new(observer));
        Ok(context)
    }
}
