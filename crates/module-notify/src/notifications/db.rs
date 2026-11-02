use super::*;
mod completion;
mod desktop;
mod preferences;
mod queries;
use crate::{DesktopNotifier, test_support::Gate};
use std::sync::{
    Mutex,
    atomic::{AtomicBool, AtomicUsize, Ordering},
};
use tenon_framework::{
    db::test_support::{self, TestDb},
    error::PERMISSION_DENIED,
    i18n::Translator,
    ipc::ActorResolver,
    job::{JobQueue, SubmitJob},
};

#[derive(Default)]
struct Notifier {
    calls: Mutex<Vec<(String, String)>>,
    fail: AtomicBool,
    focused: AtomicBool,
    focus_reads: AtomicUsize,
}
impl DesktopNotifier for Notifier {
    fn window_focused(&self) -> bool {
        self.focus_reads.fetch_add(1, Ordering::SeqCst);
        self.focused.load(Ordering::SeqCst)
    }
    fn send(&self, title: &str, body: &str) -> Result<(), AppError> {
        self.calls.lock().unwrap().push((title.into(), body.into()));
        if self.fail.load(Ordering::SeqCst) {
            Err(AppError::new(crate::DESKTOP_FAILED)
                .with_source(std::io::Error::other("private transport detail")))
        } else {
            Ok(())
        }
    }
}
struct Text;
impl Translator for Text {
    fn text_in(
        &self,
        _: tenon_framework::i18n::Language,
        key: &str,
        params: &serde_json::Map<String, serde_json::Value>,
    ) -> Result<String, AppError> {
        self.text(key, params)
    }

    fn text(&self, key: &str, params: &Map<String, Value>) -> Result<String, AppError> {
        tenon_framework::i18n::render(key, params, &|key| {
            Some(
                match key {
                    "notify.job.succeeded.title" => "Completed",
                    "notify.job.succeeded.body" => "{{kind}} completed",
                    "notify.job.failed.title" => "Failed",
                    "notify.job.failed.body" => "{{kind}}: {{error}}",
                    "notify.job.needs_review.title" => "Review",
                    "notify.job.needs_review.body" => "Review {{kind}}",
                    "notify.test.title" => "Test notification",
                    "notify.test.body" => "Notification channels are working.",
                    "jobs.kinds.notifytest.done" => "Cleanup",
                    "errors.app.permission.denied" => "Denied {{permission}}",
                    _ => return None,
                }
                .into(),
            )
        })
    }
}

async fn setup(
    test: &TestDb,
) -> (
    Arc<NotifyService>,
    JobQueue,
    ExecutionContext,
    Arc<Notifier>,
    Arc<Gate>,
) {
    let notifier = Arc::new(Notifier::default());
    let gate = Arc::new(Gate::default());
    let (service, queue, context) = setup_with(
        test,
        gate.clone(),
        notifier.clone(),
        |_| Arc::new(Text),
        Arc::new(crate::test_support::TestJobs::default()),
    )
    .await;
    (service, queue, context, notifier, gate)
}

async fn setup_with(
    test: &TestDb,
    gate: Arc<Gate>,
    notifier: Arc<dyn DesktopNotifier>,
    text: impl FnOnce(Arc<Gate>) -> Arc<dyn Translator>,
    jobs: Arc<crate::test_support::TestJobs>,
) -> (Arc<NotifyService>, JobQueue, ExecutionContext) {
    let text = text(gate.clone());
    let service = Arc::new(crate::test_support::notify(gate, notifier, || {
        Timestamp::from_millis(1_800_000_000_000).unwrap()
    }));
    let (registry, extensions, result) = crate::test_support::start(
        test,
        vec![service.account.clone(), service.clone(), jobs],
        text,
    )
    .await;
    result.unwrap();
    let context = ExecutionContext::new(
        service.account.resolve_active().await.unwrap().actor,
        "notification-test",
    );
    let queue = JobQueue::new(
        test.db.clone(),
        extensions.job_handlers().to_vec(),
        registry.schedules(),
        extensions.job_completion_hooks().to_vec(),
        tenon_framework::instance::InstanceId::load_or_create(test.root.path()).unwrap(),
    )
    .unwrap();
    (service, queue, context)
}

async fn prepare(
    test: &TestDb,
    queue: &JobQueue,
    user: Option<Id>,
    status: JobStatus,
) -> JobSnapshot {
    let id = queue
        .submit(
            &test.db,
            SubmitJob {
                kind: "notifytest.done".into(),
                payload: json!({"logId": Id::new()}),
                priority: 0,
                run_after: None,
                submitted_by: user,
            },
        )
        .await
        .unwrap();
    let mut job = queue.get(id).await.unwrap();
    job.status = status;
    job.finished_at = Some(Timestamp::now());
    if status == JobStatus::Failed {
        job.error_code = Some(PERMISSION_DENIED.as_str().into());
        job.error_params
            .insert("permission".into(), "notifytest.job.manage".into());
    }
    job
}

async fn complete(
    test: &TestDb,
    service: &Arc<NotifyService>,
    queue: &JobQueue,
    job: &JobSnapshot,
    commit: bool,
) -> Option<AfterJobCommit> {
    let mut tx = test.db.begin().await.unwrap();
    tx.execute(
        &Query::update()
            .table("fw_job")
            .value("status", job.status.as_str())
            .value("finished_at", job.finished_at.unwrap())
            .and_where(Expr::col("id").eq(job.id))
            .to_owned(),
    )
    .await
    .unwrap();
    let after = NotificationHook(service.clone())
        .complete(&mut tx, queue, job)
        .await
        .unwrap();
    if commit {
        tx.commit().await.unwrap();
        after
    } else {
        // 模拟完成钩子之后的写入失败，必须连同任务终态和两条投递记录一起回滚。
        assert!(
            tx.execute(
                &Query::update()
                    .table("fw_job")
                    .value("status", sea_query::Value::String(None))
                    .and_where(Expr::col("id").eq(job.id))
                    .to_owned()
            )
            .await
            .is_err()
        );
        tx.rollback().await.unwrap();
        drop(after);
        None
    }
}

fn input(page: u32, page_size: u32, unread_only: bool) -> NotificationListInput {
    NotificationListInput {
        pagination: PageRequest { page, page_size },
        unread_only,
    }
}

async fn deliveries(test: &TestDb) -> Vec<(String, String, Option<String>)> {
    test.rows(
        "notify_notification_delivery",
        &["channel", "status", "error_code"],
    )
    .await
}
