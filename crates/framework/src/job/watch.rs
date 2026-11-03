use super::{JobEvent, JobProgress, JobQueue, JobSnapshot, TerminalJob};
use crate::{error::AppError, id::Id, stream::Stream};

fn progress(stream: &Stream<JobEvent>, progress: &JobProgress) -> Result<(), AppError> {
    stream.progress(
        progress.current,
        progress.total,
        progress.message_key.clone(),
        progress.params.clone(),
    )
}

fn terminal(
    stream: &Stream<JobEvent>,
    job: &JobSnapshot,
    terminal: TerminalJob,
) -> Result<(), AppError> {
    match terminal {
        TerminalJob::Succeeded => stream.succeeded(Some(job.event())),
        TerminalJob::Failed { code } => stream.failed(code, job.error_params.clone()),
        TerminalJob::Cancelled => stream.cancelled(),
        TerminalJob::NeedsReview => stream.unknown("jobs.needsReview".into()),
    }
}

pub async fn watch<F>(
    queue: &JobQueue,
    id: Id,
    stream: &Stream<JobEvent>,
    still_authorized: impl Fn() -> F,
) -> Result<(), AppError>
where
    F: std::future::Future<Output = Result<(), AppError>>,
{
    // 取消覆盖快照读取及授权复核；关闭时不能等查库失败后再结束订阅。
    let result = tokio::select! {
        biased;
        _ = stream.cancellation.cancelled() => return stream.cancelled(),
        result = observe(queue, id, stream, still_authorized) => result,
    };
    result.inspect_err(|error| {
        let _ = stream.failed(error.code().as_str().into(), Default::default());
    })
}

async fn observe<F>(
    queue: &JobQueue,
    id: Id,
    stream: &Stream<JobEvent>,
    authorize: impl Fn() -> F,
) -> Result<(), AppError>
where
    F: std::future::Future<Output = Result<(), AppError>>,
{
    // 先订阅再读快照，避免首次查询期间的完成事件丢失。
    let mut events = queue.subscribe();
    authorize().await?;
    let stored = queue.read(id).await?;
    let mut current = stored.snapshot;
    authorize().await?;
    progress(stream, &current.progress)?;
    if let Some(ending) = stored.terminal {
        authorize().await?;
        return terminal(stream, &current, ending);
    }
    let mut poll = tokio::time::interval(std::time::Duration::from_secs(1));
    poll.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    loop {
        let event = tokio::select! {
            biased;
            event = events.recv() => match event {
                Ok(event) if event.job_id == id => Some(event),
                Ok(_) => {
                    authorize().await?;
                    continue;
                },
                Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => None,
                Err(tokio::sync::broadcast::error::RecvError::Closed) => {
                    authorize().await?;
                    return stream.unknown("jobs.streamClosed".into());
                },
            },
            // 同库的其他进程没有本机 broadcast；轮询补全远端变更及丢失事件。
            _ = poll.tick() => None,
        };
        authorize().await?;
        let stored = queue.read(id).await?;
        let mut next = stored.snapshot;
        if let Some(event) = event {
            if event.attempts == next.attempts
                && event.status == next.status
                && event.row_version >= next.row_version
            {
                next.progress = event.progress;
            }
        } else if next.row_version == current.row_version {
            continue;
        }
        authorize().await?;
        progress(stream, &next.progress)?;
        authorize().await?;
        if let Some(ending) = stored.terminal {
            return terminal(stream, &next, ending);
        }
        stream.delta(next.event())?;
        current = next;
    }
}
