use super::*;
use serde_json::{Value, json};
use std::{collections::BTreeMap, fs, sync::Mutex};
use tenon_framework::{
    cache::{Cache, CacheConfig, CacheConnection},
    db::{
        migrate::Dialect,
        test_support::{self, TestDb},
    },
    error::{DATA_VERSION_CONFLICT, INPUT_INVALID, JOB_CANCELLED, PERMISSION_DENIED},
    exchange::{Exchange, ExchangeFormat},
    file::{FileListInput, FilePreview},
    i18n::TestTranslator,
    instance::InstanceId,
    job::{CancellationToken, JobHandler, JobQueue},
    module::{Extensions, ModuleRegistry},
    secret::{MemoryCredentials, SecretStore},
    time::Timestamp,
};
use tenon_module_account::{AuthMode, AuthPolicy, test_support::MemoryAuthSettings};

mod drafts;
mod exchange_adapter;
mod exchange_contract;
mod jobs_attachments;
mod preferences;
mod runtime_binding;
mod sample_contract;

use exchange_adapter::{Paths, host_handlers};

struct Fixture {
    service: Arc<DemoService>,
    registry: ModuleRegistry,
    extensions: Extensions,
    queue: JobQueue,
    preferences: Arc<Mutex<DemoPreferences>>,
    paths: Paths,
    actor: ExecutionContext,
}

impl Fixture {
    async fn new(test: &TestDb) -> Self {
        Self::with_translator(test, Arc::new(TestTranslator)).await
    }

    async fn with_translator(test: &TestDb, translator: Arc<dyn Translator>) -> Self {
        let account = Arc::new(AccountService::new(
            Arc::new(MemoryAuthSettings::new(AuthPolicy {
                mode: AuthMode::None,
                session_max_hours: 24,
                captcha_after_failures: 3,
                lock_after_failures: 10,
                lock_minutes: 15,
            })),
            Timestamp::now,
        ));
        let preferences = Arc::new(Mutex::new(DemoPreferences {
            developer_mode: true,
            language: Language::ZhCn,
        }));
        let current = preferences.clone();
        let service = Arc::new(DemoService::new(
            account.clone(),
            Arc::new(move || {
                current
                    .lock()
                    .map(|value| *value)
                    .map_err(|_| AppError::new(INTERNAL_UNEXPECTED))
            }),
        ));
        let mut registry =
            ModuleRegistry::new(vec![account.clone(), service.clone()], &Default::default())
                .unwrap();
        registry
            .check_capabilities(&[Capability::Job, Capability::Exchange, Capability::File])
            .unwrap();
        let paths = Arc::new(Mutex::new(BTreeMap::new()));
        let extensions = registry
            .freeze(host_handlers(service.clone(), paths.clone()))
            .unwrap();
        test.upgrade(&registry.migrations(), 1).await.unwrap();
        let secrets =
            SecretStore::with_backend(test.root.path(), MemoryCredentials::default()).unwrap();
        let cache = Cache::connect(
            &CacheConfig {
                connection: CacheConnection::Local,
                key_prefix: "tenon-test-demo".into(),
                local_capacity: std::num::NonZeroU64::new(10_000).unwrap(),
            },
            &secrets,
        )
        .await
        .unwrap();
        let instance = InstanceId::load_or_create(test.root.path()).unwrap();
        let files = FileStore::new(
            test.db.clone(),
            test.root.path(),
            instance,
            20,
            &registry.file_purposes(),
        );
        let declarations = registry
            .declarations()
            .map(|d| (d.id, d.permissions, d.params))
            .collect::<Vec<_>>();
        let params =
            ParamStore::new(test.db.clone(), cache.clone(), secrets, &declarations).unwrap();
        registry
            .start(ModuleContext {
                extensions: &extensions,
                db: &test.db,
                cache: &cache,
                permissions: &registry.permissions(),
                dictionaries: &registry.dictionaries(),
                files: &files,
                params: &params,
                translator: &translator,
            })
            .await
            .unwrap();
        let actor = ExecutionContext::new(Actor::User(account.owner_id().unwrap()), "demo-test");
        let queue = JobQueue::new(
            test.db.clone(),
            extensions.job_handlers().to_vec(),
            registry.schedules(),
            extensions.job_completion_hooks().to_vec(),
            instance,
        )
        .unwrap();
        Self {
            service,
            registry,
            extensions,
            queue,
            preferences,
            paths,
            actor,
        }
    }
    async fn create(&self, code: &str, note: &str) -> DemoSample {
        self.service
            .sample_create(
                &self.actor,
                DemoSampleCreate {
                    code: code.into(),
                    title: format!("match {code}"),
                    note: note.into(),
                },
            )
            .await
            .unwrap()
    }
    async fn get(&self, id: Id) -> DemoSample {
        self.service
            .sample_get(&self.actor, DemoSampleId { id })
            .await
            .unwrap()
    }
    async fn list(&self, keyword: Option<&str>) -> tenon_framework::db::Page<DemoSample> {
        self.service
            .sample_list(
                &self.actor,
                DemoListInput {
                    page: 1,
                    page_size: 100,
                    keyword: keyword.map(str::to_owned),
                    stage: None,
                },
            )
            .await
            .unwrap()
    }
    fn handler(&self, kind: &str) -> &Arc<dyn JobHandler> {
        self.extensions
            .job_handlers()
            .iter()
            .find(|handler| handler.kind() == kind)
            .unwrap()
    }
    async fn run(&self, id: Id) -> Result<Value, AppError> {
        let kind = self.queue.get(id).await.unwrap().kind;
        self.handler(&kind)
            .run(
                self.queue
                    .test_context(id, CancellationToken::new())
                    .await
                    .unwrap(),
            )
            .await
    }
    fn other(&self) -> ExecutionContext {
        ExecutionContext::new(Actor::User(Id::new()), "other")
    }
}

fn version(sample: &DemoSample) -> DemoSampleVersion {
    DemoSampleVersion {
        id: sample.id,
        row_version: sample.row_version,
    }
}

#[tokio::test]
async fn schema_matches_sqlite() {
    let mut migrations = tenon_framework::migrations::MIGRATIONS.to_vec();
    migrations.extend_from_slice(tenon_module_account::migrations::MIGRATIONS);
    migrations.extend_from_slice(crate::migrations::MIGRATIONS);
    test_support::assert_migrated_schema(&migrations).await;
}
