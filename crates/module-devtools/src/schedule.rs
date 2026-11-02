use serde::Deserialize;
use tenon_framework::{
    actor::{Actor, ExecutionContext},
    error::{AppError, ErrorCode},
    id::Id,
    job::{JobQueue, JobSubmitted, ScheduleError, ScheduleSnapshot},
};
use ts_rs::TS;

pub const UNDECLARED: ErrorCode = ErrorCode::new("devtools.schedule.undeclared");

#[derive(Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct ScheduleId {
    pub id: Id,
}

fn error(error: ScheduleError) -> AppError {
    match error {
        ScheduleError::Undeclared => AppError::new(UNDECLARED),
        ScheduleError::App(error) => error,
    }
}

fn user(context: &ExecutionContext) -> Option<Id> {
    match context.actor {
        Actor::User(id) => Some(id),
        Actor::System => None,
    }
}

pub async fn list(queue: &JobQueue) -> Result<Vec<ScheduleSnapshot>, AppError> {
    queue.list_schedules().await
}

pub async fn run_now(
    queue: &JobQueue,
    context: &ExecutionContext,
    input: ScheduleId,
) -> Result<JobSubmitted, AppError> {
    Ok(JobSubmitted {
        job_id: queue
            .run_schedule_now(input.id, user(context))
            .await
            .map_err(error)?,
    })
}

#[cfg(test)]
mod db;
