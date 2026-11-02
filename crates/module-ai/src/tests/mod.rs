use super::*;
use crate::{
    test_support::{ROOT_CERT_PEM, Server, Step},
    *,
};
use serde_json::{Value, json};
use std::{future::Future, pin::Pin, sync::atomic::AtomicU8};
use tenon_framework::{
    cache::{Cache, CacheConfig, CacheConnection},
    db::test_support::{self, TestDb},
    file::test_support::file_store,
    module::ModuleRegistry,
    network::{ProxyConfig, ProxyMode},
    secret::{MemoryCredentials, SecretStore},
    time::Timestamp,
};
use tenon_module_account::{AuthMode, AuthPolicy, test_support::MemoryAuthSettings};

#[derive(Clone, Default)]
struct Events(Arc<Mutex<Vec<Value>>>);
impl StreamSink<AiStreamData> for Events {
    fn send(&self, event: StreamEvent<AiStreamData>) -> Result<(), AppError> {
        self.0
            .lock()
            .unwrap()
            .push(serde_json::to_value(event).unwrap());
        Ok(())
    }
}
impl Events {
    fn values(&self) -> Vec<Value> {
        self.0.lock().unwrap().clone()
    }
    fn terminal(&self) -> Value {
        self.values().last().unwrap().clone()
    }
}

struct Permissions(AtomicU8);
impl PermissionLookup for Permissions {
    fn has_permission<'a>(
        &'a self,
        _: Actor,
        _: &'a str,
    ) -> Pin<Box<dyn Future<Output = Result<bool, AppError>> + Send + 'a>> {
        Box::pin(async move {
            match self.0.load(Ordering::SeqCst) {
                0 => Ok(true),
                1 => Ok(false),
                2 => Err(AppError::new(INTERNAL_UNEXPECTED)),
                _ => std::future::pending().await,
            }
        })
    }
}

struct Fixture {
    ai: Arc<AiService>,
    account: Arc<AccountService>,
    params: ParamStore,
    actor: ExecutionContext,
    permissions: Arc<Permissions>,
    proxy_config: Arc<Mutex<ProxyConfig>>,
    proxy_secrets: Arc<SecretStore<MemoryCredentials>>,
}

impl Fixture {
    async fn new(test: &TestDb) -> Self {
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
        let proxy_config = Arc::new(Mutex::new(
            ProxyConfig::new(ProxyMode::Direct, String::new(), false).unwrap(),
        ));
        let proxy_secrets = Arc::new(
            SecretStore::with_backend(test.root.path(), MemoryCredentials::default()).unwrap(),
        );
        let ai = Arc::new(AiService::new(
            account.clone(),
            Arc::new({
                let config = proxy_config.clone();
                let secrets = proxy_secrets.clone();
                move |exact_loopback| {
                    let config = config
                        .lock()
                        .map_err(|_| AppError::new(INTERNAL_UNEXPECTED))?;
                    ProxySnapshot::read(&config, secrets.as_ref(), exact_loopback)
                }
            }),
        ));
        let mut registry =
            ModuleRegistry::new(vec![account.clone(), ai.clone()], &Default::default()).unwrap();
        let extensions = registry.freeze(vec![]).unwrap();
        test.upgrade(&registry.migrations(), 1).await.unwrap();
        let cache = Cache::connect(
            &cache_config(),
            &SecretStore::with_backend(test.root.path(), MemoryCredentials::default()).unwrap(),
        )
        .await
        .unwrap();
        let params = ParamStore::new(
            test.db.clone(),
            cache.clone(),
            SecretStore::with_backend(test.root.path(), MemoryCredentials::default()).unwrap(),
            &[
                (
                    "account",
                    tenon_module_account::DECLARATION.permissions,
                    tenon_module_account::DECLARATION.params,
                ),
                ("ai", DECLARATION.permissions, DECLARATION.params),
            ],
        )
        .unwrap();
        let translator: Arc<dyn tenon_framework::i18n::Translator> =
            Arc::new(tenon_framework::i18n::TestTranslator);
        registry
            .start(ModuleContext {
                extensions: &extensions,
                db: &test.db,
                cache: &cache,
                permissions: &registry.permissions(),
                dictionaries: &[],
                params: &params,
                files: &file_store(test, 20, &[]).unwrap(),
                translator: &translator,
            })
            .await
            .unwrap();
        drop(registry);
        let mut ai = match Arc::try_unwrap(ai) {
            Ok(ai) => ai,
            Err(_) => panic!("unshared service fixture"),
        };
        let permissions = Arc::new(Permissions(AtomicU8::new(0)));
        ai.started.get_mut().unwrap().permissions = permissions.clone();
        let actor =
            ExecutionContext::new(Actor::User(account.owner_id().unwrap()), "synthetic-trace");
        Self {
            ai: Arc::new(ai),
            account,
            params,
            actor,
            permissions,
            proxy_config,
            proxy_secrets,
        }
    }
    async fn set(&self, key: &str, value: &str) {
        let version = self
            .params
            .entries()
            .await
            .unwrap()
            .into_iter()
            .find(|e| e.key == key)
            .unwrap()
            .row_version;
        self.params
            .set(&self.actor, key, value, version)
            .await
            .unwrap();
    }
    async fn configure(&self, server: &Server) {
        self.set("ai.base_url", &server.url).await;
        self.set("ai.model", "synthetic/model").await;
    }
    async fn chat(&self, events: &Events) -> Result<(), AppError> {
        self.ai
            .chat(
                &self.actor,
                "main",
                input(),
                &StreamRegistry::default(),
                events.clone(),
            )
            .await
    }
    fn spawn(
        &self,
        input: AiChatInput,
        streams: StreamRegistry,
        events: Events,
    ) -> tokio::task::JoinHandle<Result<(), AppError>> {
        let ai = self.ai.clone();
        let actor = self.actor.clone();
        tokio::spawn(async move { ai.chat(&actor, "main", input, &streams, events).await })
    }
    fn owner(&self) -> StreamOwner {
        StreamOwner {
            actor: self.actor.actor,
            scope: "main".into(),
        }
    }
}

fn cache_config() -> CacheConfig {
    CacheConfig {
        connection: CacheConnection::Local,
        key_prefix: "tenon-test-ai".into(),
        local_capacity: std::num::NonZeroU64::new(10_000).unwrap(),
    }
}

fn assert_child_passed(output: &std::process::Output) {
    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    assert!(
        output.status.success() && stdout.contains("1 passed; 0 failed"),
        "isolated child must run exactly one passing test:\n{stdout}\n{stderr}"
    );
}

fn child_test(qualified_name: &str) -> std::process::Command {
    // module_path! 包含 crate 名，而 libtest 的名称从 crate 内模块开始。
    let (_, name) = qualified_name.split_once("::").unwrap();
    let mut command = std::process::Command::new(std::env::current_exe().unwrap());
    command.args(["--exact", name]);
    command
}

fn input() -> AiChatInput {
    AiChatInput {
        run_id: Id::new(),
        messages: vec![AiMessage {
            id: Id::new(),
            role: AiRole::User,
            parts: vec![AiPart::Text {
                part_id: Id::new(),
                text: "synthetic prompt".into(),
            }],
        }],
    }
}
fn chunk(delta: Value, finish: Value) -> String {
    format!(
        "data: {}\n\n",
        json!({"choices":[{"index":0,"delta":delta,"finish_reason":finish}]})
    )
}
fn complete() -> String {
    format!(
        "{}data: [DONE]\n\n",
        chunk(json!({"content":"合成结果"}), json!("stop"))
    )
}
fn error_code(result: Result<(), AppError>) -> ErrorCode {
    result.err().unwrap().code()
}

mod cancel_auth;
mod config_tls;
mod http_sse;
mod shutdown_redaction;
