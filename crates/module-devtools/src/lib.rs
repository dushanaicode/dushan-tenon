use serde::{Deserialize, Serialize};
use tenon_framework::{
    db::{Page, PageRequest},
    error::{AppError, ErrorCode},
    id::Id,
    job::{JobProgress, JobQueue, JobSnapshot, JobStatus, changed},
    module::{Capability, Module, ModuleContext, ModuleDeclaration, ModuleFuture},
    time::Timestamp,
};
use ts_rs::TS;

pub mod schedule;
pub use schedule::ScheduleId;
pub use tenon_framework::job::{JobId, ScheduleSnapshot};
pub const RESOLVED_MANUALLY: ErrorCode = ErrorCode::new("devtools.job.resolved_manually");

pub const DECLARATION: ModuleDeclaration = ModuleDeclaration {
    id: "devtools",
    version: env!("CARGO_PKG_VERSION"),
    dependencies: &["account"],
    required_capabilities: &[Capability::Job],
    core: false,
    migrations: &[],
    error_codes: &[RESOLVED_MANUALLY, schedule::UNDECLARED],
    permissions: &["devtools.job.read", "devtools.job.write"],
    file_purposes: &[],
    params: &[],
    job_kinds: &[],
    schedules: &[],
    message_keys: &[],
    dictionaries: &[],
};

pub struct DevtoolsModule;
impl Module for DevtoolsModule {
    fn declaration(&self) -> &ModuleDeclaration {
        &DECLARATION
    }
    fn start<'a>(&'a self, _: ModuleContext<'a>) -> ModuleFuture<'a> {
        Box::pin(async { Ok(()) })
    }
    fn stop(&self) -> ModuleFuture<'_> {
        Box::pin(async { Ok(()) })
    }
}

#[derive(Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct JobListInput {
    #[serde(flatten)]
    pub pagination: PageRequest,
    #[ts(optional)]
    pub status: Option<JobStatus>,
    #[ts(optional)]
    pub kind: Option<String>,
}

#[derive(Clone, Copy, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
pub enum JobOutcome {
    Succeeded,
    Failed,
}

#[derive(Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct JobResolve {
    pub id: Id,
    pub outcome: JobOutcome,
}

#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct JobSummary {
    pub id: Id,
    pub kind: String,
    pub status: JobStatus,
    pub progress: JobProgress,
    pub submitted_by: Option<Id>,
    pub created_at: Timestamp,
}

#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct JobDetail {
    #[serde(flatten)]
    pub job: JobSnapshot,
}

pub async fn list(queue: &JobQueue, input: JobListInput) -> Result<Page<JobSummary>, AppError> {
    let page = queue
        .list(input.pagination, input.status, input.kind.as_deref())
        .await?;
    Ok(Page {
        items: page
            .items
            .into_iter()
            .map(|job| JobSummary {
                id: job.id,
                kind: job.kind,
                status: job.status,
                progress: job.progress,
                submitted_by: job.submitted_by,
                created_at: job.created_at,
            })
            .collect(),
        total: page.total,
        page: page.page,
        page_size: page.page_size,
    })
}

pub async fn get(queue: &JobQueue, id: Id) -> Result<JobDetail, AppError> {
    let job = queue.get(id).await?;
    Ok(JobDetail { job })
}

pub async fn cancel(queue: &JobQueue, id: Id) -> Result<(), AppError> {
    changed(queue.cancel(id).await?)
}
pub async fn retry(queue: &JobQueue, id: Id) -> Result<(), AppError> {
    changed(queue.retry(id).await?)
}
pub async fn resolve(queue: &JobQueue, input: JobResolve) -> Result<(), AppError> {
    changed(
        queue
            .resolve(
                input.id,
                matches!(input.outcome, JobOutcome::Succeeded),
                RESOLVED_MANUALLY,
            )
            .await?,
    )
}

#[cfg(test)]
mod db;
