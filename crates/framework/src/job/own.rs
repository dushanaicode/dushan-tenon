use super::{JobEvent, JobQueue, JobSnapshot, watch};
use crate::{
    actor::Actor,
    error::{AppError, DATA_NOT_FOUND, ErrorCode},
    id::Id,
    stream::Stream,
};

pub const INVALID_STATE: ErrorCode = ErrorCode::new("app.job.invalid_state");

pub async fn require_mine(queue: &JobQueue, actor: Actor, id: Id) -> Result<(), AppError> {
    let job = queue.get(id).await?;
    if !matches!(actor, Actor::User(user) if job.submitted_by == Some(user)) {
        return Err(AppError::new(DATA_NOT_FOUND));
    }
    Ok(())
}

pub async fn get_mine(queue: &JobQueue, actor: Actor, id: Id) -> Result<JobSnapshot, AppError> {
    require_mine(queue, actor, id).await?;
    queue.get(id).await
}

pub async fn cancel_mine(queue: &JobQueue, actor: Actor, id: Id) -> Result<(), AppError> {
    require_mine(queue, actor, id).await?;
    changed(queue.cancel(id).await?)
}

pub async fn watch_mine<F>(
    queue: &JobQueue,
    actor: Actor,
    id: Id,
    stream: &Stream<JobEvent>,
    still_authorized: impl Fn() -> F,
) -> Result<(), AppError>
where
    F: std::future::Future<Output = Result<(), AppError>>,
{
    require_mine(queue, actor, id).await?;
    watch(queue, id, stream, still_authorized).await
}

pub fn changed(changed: bool) -> Result<(), AppError> {
    if changed {
        Ok(())
    } else {
        Err(AppError::new(INVALID_STATE))
    }
}
