use super::*;
use crate::{
    actor::Actor,
    db::{Tx, test_support},
    error::INPUT_INVALID,
    id::Id,
    ipc::{ActiveActor, ActorResolver, PermissionChecker},
    job::{
        JobCompletionFuture, JobCompletionHook, JobContext, JobFuture, JobHandler, JobQueue,
        JobSnapshot, PermissionLookup,
    },
};
use std::sync::atomic::{AtomicUsize, Ordering};

mod aggregate;
mod declarations;
mod dependencies;
mod handlers;
mod identity;
mod lifecycle;

type Events = Arc<Mutex<Vec<String>>>;

struct TestJob(&'static str, &'static [&'static str]);
impl JobHandler for TestJob {
    fn kind(&self) -> &'static str {
        self.0
    }
    fn permissions(&self) -> &'static [&'static str] {
        self.1
    }
    fn retry_safe(&self) -> bool {
        true
    }
    fn max_attempts(&self) -> i32 {
        1
    }
    fn run(&self, _: crate::job::JobContext) -> crate::job::JobFuture<'_> {
        Box::pin(async { Ok(serde_json::Value::Null) })
    }
}

struct TestModule {
    declaration: ModuleDeclaration,
    events: Events,
    fail_start: bool,
    stop_error: Option<ErrorCode>,
    extensions: Mutex<ModuleExtensions>,
    extension_calls: AtomicUsize,
}

impl Module for TestModule {
    fn extensions(self: Arc<Self>) -> ModuleExtensions {
        self.extension_calls.fetch_add(1, Ordering::SeqCst);
        std::mem::take(&mut *self.extensions.lock().unwrap())
    }
    fn declaration(&self) -> &ModuleDeclaration {
        &self.declaration
    }
    fn start<'a>(&'a self, _: ModuleContext<'a>) -> ModuleFuture<'a> {
        Box::pin(async {
            self.events
                .lock()
                .unwrap()
                .push(format!("start:{}", self.declaration.id));
            if self.fail_start {
                Err(AppError::new(INPUT_INVALID))
            } else {
                Ok(())
            }
        })
    }
    fn stop(&self) -> ModuleFuture<'_> {
        Box::pin(async {
            self.events
                .lock()
                .unwrap()
                .push(format!("stop:{}", self.declaration.id));
            if let Some(code) = self.stop_error {
                Err(AppError::new(code))
            } else {
                Ok(())
            }
        })
    }
}

fn module(
    id: &'static str,
    dependencies: &'static [&'static str],
    events: &Events,
) -> Arc<TestModule> {
    Arc::new(TestModule {
        declaration: ModuleDeclaration {
            file_purposes: &[],
            id,
            dependencies,
            required_capabilities: &[],
            core: false,
            version: "1",
            migrations: &[],
            error_codes: &[],
            permissions: &[],
            job_kinds: &[],
            schedules: &[],
            message_keys: &[],
            params: &[],
            dictionaries: &[],
        },
        events: events.clone(),
        fail_start: false,
        stop_error: None,
        extensions: Mutex::default(),
        extension_calls: AtomicUsize::new(0),
    })
}

#[derive(Default)]
struct Provider(AtomicUsize);

impl ActorResolver for Provider {
    fn resolve_active(
        &self,
    ) -> Pin<Box<dyn Future<Output = Result<ActiveActor, AppError>> + Send + '_>> {
        self.0.fetch_add(1, Ordering::SeqCst);
        Box::pin(async {
            Ok(ActiveActor {
                actor: Actor::System,
                permissions: vec![],
            })
        })
    }
    fn resolve_session(
        &self,
    ) -> Pin<Box<dyn Future<Output = Result<Actor, AppError>> + Send + '_>> {
        self.0.fetch_add(1, Ordering::SeqCst);
        Box::pin(async { Ok(Actor::System) })
    }
    fn resolve_public(
        &self,
    ) -> Pin<Box<dyn Future<Output = Result<Option<Actor>, AppError>> + Send + '_>> {
        self.0.fetch_add(1, Ordering::SeqCst);
        Box::pin(async { Ok(None) })
    }
}

impl PermissionChecker for Provider {
    fn check(&self, _: &ActiveActor, _: &str) -> Result<(), AppError> {
        self.0.fetch_add(1, Ordering::SeqCst);
        Ok(())
    }
}

impl PermissionLookup for Provider {
    fn has_permission<'a>(
        &'a self,
        _: Actor,
        _: &'a str,
    ) -> Pin<Box<dyn Future<Output = Result<bool, AppError>> + Send + 'a>> {
        self.0.fetch_add(1, Ordering::SeqCst);
        Box::pin(async { Ok(false) })
    }
}

impl JobCompletionHook for Provider {
    fn complete<'a>(
        &'a self,
        _: &'a mut Tx<'_>,
        _: &'a JobQueue,
        _: &'a JobSnapshot,
    ) -> JobCompletionFuture<'a> {
        self.0.fetch_add(1, Ordering::SeqCst);
        Box::pin(async { Ok(None) })
    }
}

impl JobHandler for Provider {
    fn kind(&self) -> &'static str {
        "a.job"
    }
    fn permissions(&self) -> &'static [&'static str] {
        &[]
    }
    fn retry_safe(&self) -> bool {
        true
    }
    fn max_attempts(&self) -> i32 {
        1
    }
    fn run(&self, _: JobContext) -> JobFuture<'_> {
        self.0.fetch_add(1, Ordering::SeqCst);
        Box::pin(async { Ok(serde_json::Value::Null) })
    }
}

fn identity_extensions(provider: &Arc<Provider>) -> ModuleExtensions {
    ModuleExtensions {
        actor_resolver: Some(provider.clone()),
        permission_checker: Some(provider.clone()),
        permission_lookup: Some(provider.clone()),
        ..Default::default()
    }
}

fn provide_identity(module: &Arc<TestModule>) {
    let identity = identity_extensions(&Arc::new(Provider::default()));
    let mut extensions = module.extensions.lock().unwrap();
    extensions.actor_resolver = identity.actor_resolver;
    extensions.permission_checker = identity.permission_checker;
    extensions.permission_lookup = identity.permission_lookup;
}

fn identity_module() -> Arc<TestModule> {
    let module = module("identity", &[], &Events::default());
    provide_identity(&module);
    module
}

struct Services {
    cache: Cache,
    params: ParamStore,
    files: FileStore,
    translator: Arc<dyn Translator>,
}

impl Services {
    async fn new(test: &test_support::TestDb) -> Self {
        use crate::{
            cache::{CacheConfig, CacheConnection},
            secret::{MemoryCredentials, SecretStore},
        };
        let secrets =
            SecretStore::with_backend(test.root.path(), MemoryCredentials::default()).unwrap();
        let cache = Cache::connect(
            &CacheConfig {
                connection: CacheConnection::Local,
                key_prefix: "module-test".into(),
                local_capacity: std::num::NonZeroU64::new(100).unwrap(),
            },
            &secrets,
        )
        .await
        .unwrap();
        let params = ParamStore::new(test.db.clone(), cache.clone(), secrets, &[]).unwrap();
        let files = crate::file::test_support::file_store(test, 1, &[]).unwrap();
        Self {
            cache,
            params,
            files,
            translator: Arc::new(crate::i18n::TestTranslator),
        }
    }

    fn context<'a>(
        &'a self,
        db: &'a crate::db::Db,
        extensions: &'a Extensions,
    ) -> ModuleContext<'a> {
        ModuleContext {
            extensions,
            db,
            cache: &self.cache,
            permissions: &[],
            dictionaries: &[],
            params: &self.params,
            files: &self.files,
            translator: &self.translator,
        }
    }
}
