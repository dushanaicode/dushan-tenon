use super::*;
use crate::db::test_support::{self, TestDb};
use serde_json::json;
use std::sync::atomic::{AtomicUsize, Ordering};

mod own;

mod completion;

mod instance;

struct Handler {
    kind: &'static str,
    safe: bool,
    concurrency: usize,
    local_only: bool,
    action: Arc<dyn Fn(JobContext) -> JobFuture<'static> + Send + Sync>,
}
impl JobHandler for Handler {
    fn local_only(&self) -> bool {
        self.local_only
    }
    fn kind(&self) -> &'static str {
        self.kind
    }
    fn permissions(&self) -> &'static [&'static str] {
        &["test.job.run", "test.job.write"]
    }
    fn retry_safe(&self) -> bool {
        self.safe
    }
    fn max_attempts(&self) -> i32 {
        3
    }
    fn concurrency(&self) -> usize {
        self.concurrency
    }
    fn run(&self, context: JobContext) -> JobFuture<'_> {
        (self.action)(context)
    }
}
struct Permission(bool);
impl PermissionLookup for Permission {
    fn has_permission<'a>(
        &'a self,
        _: Actor,
        _: &'a str,
    ) -> Pin<Box<dyn Future<Output = Result<bool, AppError>> + Send + 'a>> {
        Box::pin(async { Ok(self.0) })
    }
}
fn handler(
    kind: &'static str,
    safe: bool,
    action: impl Fn(JobContext) -> JobFuture<'static> + Send + Sync + 'static,
) -> Arc<Handler> {
    Arc::new(Handler {
        kind,
        safe,
        concurrency: 1,
        local_only: false,
        action: Arc::new(action),
    })
}
fn success() -> Arc<Handler> {
    handler("test.one", true, |_| {
        Box::pin(async { Ok(json!({"ok":true})) })
    })
}
fn input(kind: &str) -> SubmitJob {
    SubmitJob {
        kind: kind.into(),
        payload: json!({}),
        priority: 0,
        run_after: None,
        submitted_by: None,
    }
}
async fn queue(test: &TestDb, handlers: Vec<Arc<dyn JobHandler>>) -> JobQueue {
    test.upgrade(crate::migrations::MIGRATIONS, 1)
        .await
        .unwrap();
    JobQueue::new(
        test.db.clone(),
        handlers,
        vec![],
        vec![],
        crate::instance::InstanceId::load_or_create(test.root.path()).unwrap(),
    )
    .unwrap()
}
async fn wait(queue: &JobQueue, id: Id, status: JobStatus) -> JobSnapshot {
    tokio::time::timeout(Duration::from_secs(10), async {
        loop {
            let job = queue.get(id).await.unwrap();
            if job.status == status {
                return job;
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    })
    .await
    .expect("job did not reach expected state")
}
async fn claim(queue: &JobQueue, id: Id) -> LeasedJob {
    queue
        .claim(id, "owner", Timestamp::now(), 10)
        .await
        .unwrap()
        .unwrap()
}

mod boundaries;
mod execution;
mod leasing;
mod progress;
