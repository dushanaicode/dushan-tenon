use sea_query::{Expr, ExprTrait, Query};
use std::{
    collections::BTreeMap,
    sync::{Arc, Mutex},
    time::Duration,
};
use tokio::{
    sync::Mutex as AsyncMutex,
    task::{JoinHandle, JoinSet},
    time::{Instant, MissedTickBehavior},
};
use uuid::Uuid;

use super::{store, *};
use crate::{
    error::{JOB_CANCELLED, PERMISSION_DENIED},
    id::Id,
    maintenance::OperationGate,
    time::Timestamp,
};

pub struct JobRunner {
    stop: CancellationToken,
    handle: Mutex<Option<JoinHandle<()>>>,
}

impl JobRunner {
    pub async fn start(
        queue: JobQueue,
        permissions: Arc<dyn PermissionLookup>,
        config: JobsConfig,
        gate: OperationGate,
    ) -> Result<Self, AppError> {
        let permit = gate.enter()?;
        queue.sync_schedules(Timestamp::now()).await?;
        if let Err(error) = queue.reconcile(Timestamp::now()).await {
            tracing::error!(code = %error.code(), "启动时任务核对失败，下次轮询重试");
        }
        let stop = CancellationToken::new();
        drop(permit);
        let handle = tokio::spawn(run(
            queue,
            permissions,
            config,
            Uuid::new_v4().to_string(),
            stop.clone(),
            gate,
        ));
        Ok(Self {
            stop,
            handle: Mutex::new(Some(handle)),
        })
    }

    pub async fn stop(&self) -> Result<(), AppError> {
        self.stop.cancel();
        let handle = self
            .handle
            .lock()
            .map_err(|_| AppError::new(INTERNAL_UNEXPECTED))?
            .take();
        if let Some(handle) = handle
            && let Err(error) = handle.await
        {
            tracing::error!(
                panicked = error.is_panic(),
                cancelled = error.is_cancelled(),
                "任务执行器关闭异常"
            );
        }
        Ok(())
    }
}

impl Drop for JobRunner {
    fn drop(&mut self) {
        self.stop.cancel();
        if let Some(handle) = self
            .handle
            .get_mut()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .take()
        {
            handle.abort();
        }
    }
}

async fn run(
    queue: JobQueue,
    permissions: Arc<dyn PermissionLookup>,
    config: JobsConfig,
    owner: String,
    stop: CancellationToken,
    gate: OperationGate,
) {
    let mut tasks = JoinSet::new();
    let mut kinds = BTreeMap::new();
    let force = CancellationToken::new();
    let mut interval = tokio::time::interval(Duration::from_secs(1));
    interval.set_missed_tick_behavior(MissedTickBehavior::Skip);
    loop {
        tokio::select! {
            biased;
            _ = stop.cancelled() => break,
            joined = tasks.join_next_with_id(), if !tasks.is_empty() => {
                if let Some(joined) = joined { completed(joined, &mut kinds); }
            }
            _ = interval.tick() => {},
            _ = queue.0.notify.notified() => {},
        }
        if stop.is_cancelled() {
            break;
        }
        let permit = match gate.enter() {
            Ok(permit) => permit,
            Err(_) if gate.is_closing() => break,
            Err(_) => continue,
        };
        let poll = async {
            queue.trigger_schedules(Timestamp::now()).await?;
            queue.reconcile(Timestamp::now()).await?;
            if tasks.len() >= config.max_concurrency() {
                return Ok::<_, AppError>(());
            }
            for candidate in queue.candidates(Timestamp::now()).await? {
                if stop.is_cancelled() || tasks.len() >= config.max_concurrency() {
                    break;
                }
                let Some(registered) = queue.0.handlers.get(candidate.kind.as_str()) else {
                    continue;
                };
                let handler = &registered.handler;
                if kinds
                    .values()
                    .filter(|&&kind| kind == handler.kind())
                    .count()
                    >= handler.concurrency()
                {
                    continue;
                }
                if let Some(job) = queue
                    .claim(
                        candidate.id,
                        &owner,
                        Timestamp::now(),
                        config.lease_seconds(),
                    )
                    .await?
                {
                    let kind = handler.kind();
                    let work = run_job(
                        queue.clone(),
                        handler.clone(),
                        permissions.clone(),
                        job,
                        config.lease_seconds(),
                        force.clone(),
                    );
                    let permit = permit.clone();
                    let handle = tasks.spawn(async move {
                        let _permit = permit;
                        work.await
                    });
                    kinds.insert(handle.id(), kind);
                }
            }
            Ok(())
        }
        .await;
        if let Err(error) = poll {
            tracing::error!(code = %error.code(), "任务队列轮询失败");
        }
    }
    let draining = async {
        while let Some(joined) = tasks.join_next_with_id().await {
            completed(joined, &mut kinds);
        }
    };
    if tokio::time::timeout(Duration::from_secs(10), draining)
        .await
        .is_err()
    {
        // 关闭时取消执行 future，释放持有的资源；完成状态仍受租约栅栏保护。
        force.cancel();
        while let Some(joined) = tasks.join_next_with_id().await {
            completed(joined, &mut kinds);
        }
    }
}

fn completed(
    joined: Result<(tokio::task::Id, Result<(), AppError>), tokio::task::JoinError>,
    kinds: &mut BTreeMap<tokio::task::Id, &'static str>,
) {
    match joined {
        Ok((id, result)) => {
            kinds.remove(&id);
            if let Err(error) = result {
                tracing::error!(code = %error.code(), "任务执行或状态写入失败，等待租约核对");
            }
        }
        Err(error) => {
            kinds.remove(&error.id());
            tracing::error!("任务执行器异常退出，等待租约核对");
        }
    }
}

pub(super) struct ProgressReporter {
    queue: JobQueue,
    job: LeasedJob,
    cancellation: CancellationToken,
    state: AsyncMutex<ProgressState>,
    #[cfg(test)]
    test_elapsed_since_write: Option<Duration>,
}

struct ProgressState {
    progress: JobProgress,
    dirty: bool,
    last_write: Option<Instant>,
    version: i64,
}

impl ProgressReporter {
    pub(super) fn id(&self) -> Id {
        self.job.snapshot.id
    }

    pub(super) async fn buffer(&self, progress: JobProgress) {
        let mut state = self.state.lock().await;
        state.progress = progress;
        state.dirty = true;
        self.queue.broadcast(JobEvent {
            job_id: self.job.snapshot.id,
            status: JobStatus::Running,
            progress: state.progress.clone(),
            attempts: self.job.snapshot.attempts,
            row_version: state.version,
        });
    }
    pub(super) fn new(queue: JobQueue, job: LeasedJob, cancellation: CancellationToken) -> Self {
        let state = ProgressState {
            progress: job.snapshot.progress.clone(),
            dirty: false,
            last_write: None,
            version: job.snapshot.row_version,
        };
        Self {
            queue,
            job,
            cancellation,
            state: AsyncMutex::new(state),
            #[cfg(test)]
            test_elapsed_since_write: None,
        }
    }

    pub(super) async fn report(&self, progress: JobProgress) -> Result<(), AppError> {
        let mut state = self.state.lock().await;
        state.progress = progress;
        state.dirty = true;
        if state.last_write.is_none_or(|last| {
            let elapsed = last.elapsed();
            #[cfg(test)]
            let elapsed = self.test_elapsed_since_write.unwrap_or(elapsed);
            elapsed >= Duration::from_millis(500)
        }) {
            self.write(&mut state).await?;
        }
        self.queue.broadcast(JobEvent {
            job_id: self.job.snapshot.id,
            status: JobStatus::Running,
            progress: state.progress.clone(),
            attempts: self.job.snapshot.attempts,
            row_version: state.version,
        });
        Ok(())
    }

    async fn flush(&self) -> Result<(), AppError> {
        let mut state = self.state.lock().await;
        if state.dirty {
            self.write(&mut state).await?;
        }
        Ok(())
    }

    async fn write(&self, state: &mut ProgressState) -> Result<(), AppError> {
        let mut statement =
            store::leased(self.job.snapshot.id, &self.job.owner, self.job.started_at);
        statement
            .value("progress_current", state.progress.current)
            .value("progress_total", state.progress.total)
            .value("progress_message", state.progress.message_key.clone())
            .value(
                "progress_params",
                serde_json::to_string(&state.progress.params)
                    .map_err(|error| AppError::new(INTERNAL_UNEXPECTED).with_source(error))?,
            );
        if self.queue.0.db.execute(&statement).await? == 0 {
            self.cancellation.cancel();
            return Err(AppError::new(JOB_CANCELLED));
        }
        state.last_write = Some(Instant::now());
        state.dirty = false;
        state.version = self.queue.get(self.job.snapshot.id).await?.row_version;
        Ok(())
    }
}

async fn heartbeat(
    queue: &JobQueue,
    job: &LeasedJob,
    lease_seconds: u64,
    cancellation: &CancellationToken,
) -> Result<bool, AppError> {
    let statement = store::leased(job.snapshot.id, &job.owner, job.started_at)
        .value(
            "lease_expires_at",
            Timestamp::now().as_millis() + lease_seconds as i64 * 1000,
        )
        .to_owned();
    if queue.0.db.execute(&statement).await? == 0 {
        cancellation.cancel();
        return Ok(false);
    }
    if queue.get(job.snapshot.id).await?.cancel_requested {
        cancellation.cancel();
    }
    Ok(true)
}

async fn run_job(
    queue: JobQueue,
    handler: Arc<dyn JobHandler>,
    permissions: Arc<dyn PermissionLookup>,
    job: LeasedJob,
    lease_seconds: u64,
    force: CancellationToken,
) -> Result<(), AppError> {
    let cancellation = CancellationToken::new();
    let _running = RunningJob::new(queue.clone(), job.snapshot.id, cancellation.clone())?;
    let failure_result = Arc::new(Mutex::new(None));
    if job.snapshot.cancel_requested {
        cancellation.cancel();
    }
    let actor = job.snapshot.submitted_by.map_or(Actor::System, Actor::User);
    let reporter = Arc::new(ProgressReporter::new(
        queue.clone(),
        job.clone(),
        cancellation.clone(),
    ));
    let result = {
        let execute = async {
            if cancellation.is_cancelled() {
                return Err(AppError::new(JOB_CANCELLED));
            }
            if actor != Actor::System {
                for permission in handler.permissions() {
                    if !permissions.has_permission(actor, permission).await? {
                        return Err(
                            AppError::new(PERMISSION_DENIED).with_param("permission", *permission)
                        );
                    }
                }
            }
            handler
                .run(JobContext {
                    payload: job.snapshot.payload.clone(),
                    execution: ExecutionContext::new(actor, Id::new().to_string()),
                    db: queue.0.db.clone(),
                    cancellation: cancellation.clone(),
                    reporter: reporter.clone(),
                    failure_result: failure_result.clone(),
                    #[cfg(any(test, feature = "test-support"))]
                    progress_observer: None,
                })
                .await
        };
        let duration = Duration::from_secs(lease_seconds) / 3;
        let mut interval = tokio::time::interval_at(Instant::now() + duration, duration);
        interval.set_missed_tick_behavior(MissedTickBehavior::Skip);
        let renew = async {
            loop {
                interval.tick().await;
                if !heartbeat(&queue, &job, lease_seconds, &cancellation).await? {
                    return Ok::<(), AppError>(());
                }
            }
        };
        // 心跳的数据库等待不能暂停处理器，否则处理器持有的事务无法继续提交。
        tokio::select! {
            biased;
            _ = force.cancelled() => { cancellation.cancel(); Err(AppError::new(JOB_CANCELLED)) }
            result = execute => result,
            result = renew => { cancellation.cancel(); result?; return Ok(()); }
        }
    };
    if let Err(error) = reporter.flush().await {
        if error.code() == JOB_CANCELLED {
            return Ok(());
        }
        return Err(error);
    }
    let failure_result = failure_result
        .lock()
        .map_err(|_| AppError::new(INTERNAL_UNEXPECTED))?
        .take();
    loop {
        match finish(
            &queue,
            &job,
            cancellation.is_cancelled(),
            &result,
            failure_result.as_ref(),
        )
        .await
        {
            Ok(()) => return Ok(()),
            Err(error) => {
                tracing::error!(code = %error.code(), "任务结束事务失败，保留执行结果并重试");
                tokio::select! {
                    _ = force.cancelled() => return Err(error),
                    _ = tokio::time::sleep(Duration::from_secs(1)) => {},
                }
                if !heartbeat(&queue, &job, lease_seconds, &cancellation).await? {
                    return Ok(());
                }
            }
        }
    }
}

fn backoff(attempts: i32) -> i64 {
    std::cmp::min(
        5_000_i64 * (1_i64 << std::cmp::min(attempts - 1, 6)),
        300_000,
    )
}

async fn finish(
    queue: &JobQueue,
    job: &LeasedJob,
    cancelled: bool,
    result: &Result<serde_json::Value, AppError>,
    failure_result: Option<&serde_json::Value>,
) -> Result<(), AppError> {
    let mut tx = queue.0.db.begin().await?;
    let row: Option<(bool,)> = tx
        .fetch_optional(
            &Query::select()
                .column("cancel_requested")
                .from("fw_job")
                .and_where(Expr::col("id").eq(job.snapshot.id))
                .and_where(Expr::col("status").eq("running"))
                .and_where(Expr::col("lease_owner").eq(&job.owner))
                .and_where(Expr::col("started_at").eq(job.started_at))
                .lock_exclusive()
                .to_owned(),
        )
        .await?;
    let Some((requested,)) = row else {
        return tx.rollback().await;
    };
    let now = Timestamp::now();
    let mut statement = store::leased(job.snapshot.id, &job.owner, job.started_at);
    store::clear_lease(&mut statement);
    let (status, result, error_code, error_params, finished_at) =
        if requested
            || cancelled
            || result
                .as_ref()
                .is_err_and(|error| error.code() == JOB_CANCELLED)
        {
            ("cancelled", None, None, None, Some(now.as_millis()))
        } else {
            match result {
                Ok(value) => (
                    "succeeded",
                    Some(value.to_string()),
                    None,
                    None,
                    Some(now.as_millis()),
                ),
                Err(error) => {
                    let retry = error.code() != PERMISSION_DENIED
                        && job.snapshot.retry_safe
                        && job.snapshot.attempts < job.snapshot.max_attempts;
                    if retry {
                        statement.value(
                            "run_after",
                            now.as_millis() + backoff(job.snapshot.attempts),
                        );
                    }
                    (
                        if retry { "queued" } else { "failed" },
                        if retry {
                            None
                        } else {
                            failure_result.map(serde_json::Value::to_string)
                        },
                        Some(error.code().as_str()),
                        Some(serde_json::to_string(&store::error_params(error)).map_err(
                            |error| AppError::new(INTERNAL_UNEXPECTED).with_source(error),
                        )?),
                        (!retry).then_some(now.as_millis()),
                    )
                }
            }
        };
    statement
        .value("status", status)
        .value("result", result)
        .value("error_code", error_code)
        .value("error_params", error_params)
        .value("finished_at", finished_at);
    let changed = tx.execute(&statement).await?;
    let callbacks = if changed == 1 {
        queue.complete(&mut tx, job.snapshot.id).await?
    } else {
        Vec::new()
    };
    tx.commit().await?;
    if changed == 1 {
        queue.after_commit(job.snapshot.id, callbacks).await?;
    }
    Ok(())
}

struct RunningJob {
    queue: JobQueue,
    id: Id,
}
impl RunningJob {
    fn new(queue: JobQueue, id: Id, cancellation: CancellationToken) -> Result<Self, AppError> {
        queue
            .0
            .running
            .lock()
            .map_err(|_| AppError::new(INTERNAL_UNEXPECTED))?
            .insert(id, cancellation);
        Ok(Self { queue, id })
    }
}
impl Drop for RunningJob {
    fn drop(&mut self) {
        match self.queue.0.running.lock() {
            Ok(mut running) => {
                running.remove(&self.id);
            }
            Err(_) => tracing::error!("任务析构时运行登记锁中毒"),
        }
    }
}

#[cfg(test)]
mod tests;
