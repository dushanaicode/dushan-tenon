use super::*;
use tenon_framework::{
    actor::Actor,
    cache::{Cache, CacheConfig, CacheConnection},
    db::test_support::{self, TestDb},
    file::test_support::file_store,
    i18n::{TestTranslator, Translator},
    instance::InstanceId,
    ipc::ActorResolver,
    job::{INVALID_STATE, SubmitJob},
    module::ModuleRegistry,
    param::ParamStore,
    secret::{MemoryCredentials, SecretStore},
};
use tenon_module_account::{
    AccountService, AuthMode, AuthPolicy, test_support::MemoryAuthSettings,
};

use sea_query::{Expr, ExprTrait, Query};
use serde_json::json;
use std::{num::NonZeroU64, sync::Arc};

fn account() -> Arc<AccountService> {
    Arc::new(AccountService::new(
        Arc::new(MemoryAuthSettings::new(AuthPolicy {
            mode: AuthMode::None,
            session_max_hours: 24,
            captcha_after_failures: 3,
            lock_after_failures: 10,
            lock_minutes: 15,
        })),
        Timestamp::now,
    ))
}

pub(crate) async fn setup(test: &TestDb) -> (Arc<AccountService>, ModuleRegistry, JobQueue) {
    let account = account();
    let mut registry = ModuleRegistry::new(
        vec![
            account.clone(),
            Arc::new(DevtoolsModule),
            Arc::new(TestJobs),
        ],
        &Default::default(),
    )
    .unwrap();
    let extensions = registry.freeze(vec![]).unwrap();
    test.upgrade(&registry.migrations(), 1).await.unwrap();
    let secrets =
        SecretStore::with_backend(test.root.path(), MemoryCredentials::default()).unwrap();
    let cache = Cache::connect(
        &CacheConfig {
            connection: CacheConnection::Local,
            key_prefix: "tenon-test-devtools".into(),
            local_capacity: NonZeroU64::new(10_000).unwrap(),
        },
        &secrets,
    )
    .await
    .unwrap();
    let params = ParamStore::new(
        test.db.clone(),
        cache.clone(),
        secrets,
        &registry
            .declarations()
            .map(|declaration| (declaration.id, declaration.permissions, declaration.params))
            .collect::<Vec<_>>(),
    )
    .unwrap();
    let files = file_store(test, 20, &registry.file_purposes()).unwrap();
    let translator: Arc<dyn Translator> = Arc::new(TestTranslator);
    registry
        .start(ModuleContext {
            extensions: &extensions,
            files: &files,
            translator: &translator,
            db: &test.db,
            cache: &cache,
            params: &params,
            permissions: &registry.permissions(),
            dictionaries: &registry.dictionaries(),
        })
        .await
        .unwrap();
    let queue = JobQueue::new(
        test.db.clone(),
        extensions.job_handlers().to_vec(),
        registry.schedules(),
        extensions.job_completion_hooks().to_vec(),
        InstanceId::load_or_create(test.root.path()).unwrap(),
    )
    .unwrap();
    (account, registry, queue)
}
fn page(page: u32, status: Option<JobStatus>, kind: Option<&str>) -> JobListInput {
    JobListInput {
        pagination: PageRequest { page, page_size: 1 },
        status,
        kind: kind.map(str::to_owned),
    }
}
async fn state(test: &TestDb, id: Id, status: &str) {
    test.db
        .execute(
            &Query::update()
                .table("fw_job")
                .value("status", status)
                .value(
                    "started_at",
                    (status == "running").then_some(Timestamp::now().as_millis()),
                )
                .value(
                    "lease_owner",
                    (status == "running").then_some("devtools-test"),
                )
                .value("attempts", i32::from(status == "running"))
                .value("row_version", Expr::col("row_version").add(1_i64))
                .and_where(Expr::col("id").eq(id))
                .to_owned(),
        )
        .await
        .unwrap();
}

#[tokio::test]
async fn list_filters_get_and_state_transitions() {
    test_support::run(async |test| {
        let (account, registry, queue) = setup(test).await;
        let actor = account.resolve_active().await.unwrap().actor;
        let first = queue
            .submit(
                &test.db,
                SubmitJob {
                    kind: "sample.cleanup".into(),
                    payload: json!({}),
                    priority: 0,
                    run_after: None,
                    submitted_by: match actor {
                        Actor::User(id) => Some(id),
                        Actor::System => None,
                    },
                },
            )
            .await
            .unwrap();
        let second = queue
            .submit(
                &test.db,
                SubmitJob {
                    kind: "sample.cleanup".into(),
                    payload: json!({}),
                    priority: 0,
                    run_after: None,
                    submitted_by: None,
                },
            )
            .await
            .unwrap();
        let result = list(&queue, page(1, None, None)).await.unwrap();
        assert_eq!(result.total, 2);
        assert_eq!(result.items[0].id, second);
        let result = list(&queue, page(2, None, None)).await.unwrap();
        assert_eq!(result.items[0].id, first);
        assert_eq!(
            result.items[0].submitted_by,
            Some(account.owner_id().unwrap())
        );
        let detail = get(&queue, first).await.unwrap();
        assert_eq!(detail.job.attempts, 0);
        assert_eq!(detail.job.submitted_by, Some(account.owner_id().unwrap()));
        assert_eq!(
            list(&queue, page(1, None, Some("unknown.kind")))
                .await
                .unwrap()
                .total,
            0
        );
        assert_eq!(
            retry(&queue, first).await.unwrap_err().code(),
            INVALID_STATE
        );
        assert_eq!(
            resolve(
                &queue,
                JobResolve {
                    id: first,
                    outcome: JobOutcome::Succeeded
                }
            )
            .await
            .unwrap_err()
            .code(),
            INVALID_STATE
        );
        cancel(&queue, first).await.unwrap();
        assert_eq!(
            cancel(&queue, first).await.unwrap_err().code(),
            INVALID_STATE
        );
        assert_eq!(
            list(
                &queue,
                page(1, Some(JobStatus::Cancelled), Some("sample.cleanup"))
            )
            .await
            .unwrap()
            .total,
            1
        );
        for status in ["failed", "cancelled", "needs_review"] {
            state(test, first, status).await;
            test.db
                .execute(
                    &Query::update()
                        .table("fw_job")
                        .value("attempts", 3)
                        .value("error_code", "app.internal.unexpected")
                        .value("result", "{}")
                        .and_where(Expr::col("id").eq(first))
                        .to_owned(),
                )
                .await
                .unwrap();
            retry(&queue, first).await.unwrap();
            let row = queue.get(first).await.unwrap();
            assert_eq!(row.status, JobStatus::Queued);
            assert_eq!(row.attempts, 0);
            assert!(row.result.is_none() && row.error_code.is_none());
        }
        state(test, first, "running").await;
        cancel(&queue, first).await.unwrap();
        assert!(queue.get(first).await.unwrap().cancel_requested);
        assert_eq!(
            retry(&queue, first).await.unwrap_err().code(),
            INVALID_STATE
        );
        for outcome in [JobOutcome::Succeeded, JobOutcome::Failed] {
            state(test, first, "needs_review").await;
            resolve(&queue, JobResolve { id: first, outcome })
                .await
                .unwrap();
            let row = queue.get(first).await.unwrap();
            assert_eq!(row.error_code.as_deref(), Some(RESOLVED_MANUALLY.as_str()));
            assert_eq!(
                row.status,
                if matches!(outcome, JobOutcome::Succeeded) {
                    JobStatus::Succeeded
                } else {
                    JobStatus::Failed
                }
            );
            assert_eq!(
                resolve(&queue, JobResolve { id: first, outcome })
                    .await
                    .unwrap_err()
                    .code(),
                INVALID_STATE
            );
        }
        registry.stop().await.unwrap();
    })
    .await;
}

#[tokio::test]
async fn devtools_registry_schema_includes_jobs_and_account() {
    let registry = ModuleRegistry::new(
        vec![account(), Arc::new(DevtoolsModule)],
        &Default::default(),
    )
    .unwrap();
    test_support::assert_migrated_schema(&registry.migrations()).await;
}

// 列表、重试和计划测试使用独立的测试模块声明与处理器。
struct TestJobs;

impl tenon_framework::module::Module for TestJobs {
    fn declaration(&self) -> &tenon_framework::module::ModuleDeclaration {
        const TEST_JOBS: tenon_framework::module::ModuleDeclaration =
            tenon_framework::module::ModuleDeclaration {
                id: "sample",
                error_codes: &[],
                permissions: &["sample.log.manage"],
                job_kinds: &["sample.cleanup"],
                schedules: &[tenon_framework::job::ScheduleDeclaration {
                    key: "sample.cleanup_daily",
                    kind: "sample.cleanup",
                    cron: "0 3 * * *",
                    enabled: true,
                    payload: "{}",
                }],
                ..DECLARATION
            };
        &TEST_JOBS
    }

    fn extensions(self: Arc<Self>) -> tenon_framework::module::ModuleExtensions {
        tenon_framework::module::ModuleExtensions {
            job_handlers: vec![self],
            ..Default::default()
        }
    }

    fn start<'a>(&'a self, _: ModuleContext<'a>) -> ModuleFuture<'a> {
        Box::pin(async { Ok(()) })
    }

    fn stop(&self) -> ModuleFuture<'_> {
        Box::pin(async { Ok(()) })
    }
}

impl tenon_framework::job::JobHandler for TestJobs {
    fn kind(&self) -> &'static str {
        "sample.cleanup"
    }
    fn permissions(&self) -> &'static [&'static str] {
        &["sample.log.manage"]
    }
    fn retry_safe(&self) -> bool {
        true
    }
    fn max_attempts(&self) -> i32 {
        3
    }
    fn run(&self, _: tenon_framework::job::JobContext) -> tenon_framework::job::JobFuture<'_> {
        panic!("列表与计划测试不运行处理器")
    }
}
