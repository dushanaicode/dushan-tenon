use crate::{DesktopDelivery, DesktopGate, DesktopNotifier, NotifyService};
use std::sync::{
    Arc, RwLock,
    atomic::{AtomicUsize, Ordering},
};
use tenon_framework::{
    cache::{Cache, CacheConfig, CacheConnection},
    db::test_support::TestDb,
    error::{AppError, INTERNAL_UNEXPECTED},
    i18n::Translator,
    job::{JobContext, JobFuture, JobHandler},
    module::{
        Extensions, Module, ModuleContext, ModuleDeclaration, ModuleExtensions, ModuleFuture,
        ModuleRegistry,
    },
    param::ParamStore,
    secret::{MemoryCredentials, SecretStore},
    time::Timestamp,
};
use tenon_module_account::{
    AccountService, AuthMode, AuthPolicy, test_support::MemoryAuthSettings,
};

pub(crate) struct Gate(pub(crate) RwLock<bool>);
impl Default for Gate {
    fn default() -> Self {
        Self(RwLock::new(true))
    }
}
impl DesktopGate for Gate {
    fn with_enabled(
        &self,
        send: &mut dyn FnMut() -> Result<DesktopDelivery, AppError>,
    ) -> Result<DesktopDelivery, AppError> {
        let enabled = self
            .0
            .read()
            .map_err(|_| AppError::new(INTERNAL_UNEXPECTED))?;
        if *enabled {
            send()
        } else {
            Ok(DesktopDelivery::Skipped)
        }
    }
}

pub(crate) fn notify(
    gate: Arc<dyn DesktopGate>,
    notifier: Arc<dyn DesktopNotifier>,
    clock: impl Fn() -> Timestamp + Send + Sync + 'static,
) -> NotifyService {
    let clock = Arc::new(clock);
    let account_clock = clock.clone();
    let account = Arc::new(AccountService::new(
        Arc::new(MemoryAuthSettings::new(AuthPolicy {
            mode: AuthMode::None,
            session_max_hours: 24,
            captcha_after_failures: 3,
            lock_after_failures: 10,
            lock_minutes: 15,
        })),
        move || account_clock(),
    ));
    NotifyService::new(account, gate, notifier, move || clock())
}

pub(crate) async fn start(
    test: &TestDb,
    modules: Vec<Arc<dyn Module>>,
    translator: Arc<dyn Translator>,
) -> (ModuleRegistry, Extensions, Result<(), AppError>) {
    let mut registry = ModuleRegistry::new(modules, &Default::default()).unwrap();
    let extensions = registry.freeze(vec![]).unwrap();
    registry
        .check_capabilities(&[tenon_framework::module::Capability::Job])
        .unwrap();
    test.upgrade(&registry.migrations(), 1).await.unwrap();
    let secrets =
        SecretStore::with_backend(test.root.path(), MemoryCredentials::default()).unwrap();
    let cache = Cache::connect(
        &CacheConfig {
            connection: CacheConnection::Local,
            key_prefix: "tenon-test-notify".into(),
            local_capacity: std::num::NonZeroU64::new(10_000).unwrap(),
        },
        &secrets,
    )
    .await
    .unwrap();
    let declarations = registry
        .declarations()
        .map(|d| (d.id, d.permissions, d.params))
        .collect::<Vec<_>>();
    let result = registry
        .start(ModuleContext {
            extensions: &extensions,
            db: &test.db,
            cache: &cache,
            permissions: &registry.permissions(),
            dictionaries: &registry.dictionaries(),
            files: &tenon_framework::file::test_support::file_store(test, 20, &[]).unwrap(),
            params: &ParamStore::new(test.db.clone(), cache.clone(), secrets, &declarations)
                .unwrap(),
            translator: &translator,
        })
        .await;
    (registry, extensions, result)
}

#[derive(Default)]
pub(crate) struct TestJobs(pub(crate) Arc<AtomicUsize>);

impl Module for TestJobs {
    fn declaration(&self) -> &ModuleDeclaration {
        static DECLARATION: ModuleDeclaration = ModuleDeclaration {
            id: "notifytest",
            version: "0.1.0",
            dependencies: &[],
            core: false,
            required_capabilities: &[],
            migrations: &[],
            error_codes: &[],
            permissions: &["notifytest.job.manage"],
            job_kinds: &["notifytest.done"],
            schedules: &[],
            message_keys: &[],
            dictionaries: &[],
            params: &[],
            file_purposes: &[],
        };
        &DECLARATION
    }
    fn extensions(self: Arc<Self>) -> ModuleExtensions {
        ModuleExtensions {
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

impl JobHandler for TestJobs {
    fn kind(&self) -> &'static str {
        "notifytest.done"
    }
    fn permissions(&self) -> &'static [&'static str] {
        &[]
    }
    fn retry_safe(&self) -> bool {
        false
    }
    fn max_attempts(&self) -> i32 {
        1
    }
    fn run(&self, _: JobContext) -> JobFuture<'_> {
        self.0.fetch_add(1, Ordering::SeqCst);
        Box::pin(async { Ok(serde_json::json!({})) })
    }
}
