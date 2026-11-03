//! 具体阶段消耗式启动；每个关闭动作在资源获得时捕获句柄。

use clap::Parser;
use std::{
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
};
use tauri::{AppHandle, Manager, Runtime};
use tenon_desktop::{
    config::{self, ConfigSource},
    identity::CREDENTIAL_SERVICE,
    picked_files::PickedFileStore,
};
use tenon_framework::{
    bootstrap::{ShutdownStack, Started, step},
    cache::Cache,
    db::{
        Db,
        migrate::{self, MigrationStatus},
    },
    error::{AppError, INTERNAL_UNEXPECTED},
    file::FileStore,
    i18n::Translator,
    instance::InstanceId,
    job::{JobQueue, JobRunner},
    logging::{self, LogLevelHandle, StartupRecord},
    module::{Capability, Extensions, Identity, ModuleContext, ModuleRegistry},
    network::{ProxySecrets, ProxySnapshot},
    param::ParamStore,
    secret::SecretStore,
    stream::StreamRegistry,
    time::Timestamp,
};
use tenon_module_account::AccountService;
use tenon_module_ai::AiService;
use tenon_module_demo::{DemoPreferences, DemoService};
use tenon_module_notify::{DesktopNotifier, NotifyService};

use crate::{
    exchange, i18n,
    lifecycle::Lifecycle,
    modules,
    native::{self, NativeServices},
    notification::SystemNotifier,
    ports::{self, SettingsPorts},
    state::{AppState, SharedConfig},
};

#[derive(Default, Parser)]
#[command(version, about)]
pub(crate) struct Options {
    /// 应用状态目录，优先于 TENON_STATE_ROOT。
    #[arg(long, value_name = "PATH")]
    pub state_root: Option<PathBuf>,
    /// 配置覆盖，可重复，例如 --set logging.level=debug。
    #[arg(long = "set", value_name = "段.键=值")]
    pub overrides: Vec<String>,
    #[arg(long, hide = true, value_parser = parse_prepared)]
    pub restore_prepared: Option<String>,
    /// 仅本次使用基础界面，不写回配置。
    #[arg(long)]
    pub safe_mode: bool,
    /// 系统文件、目录或应用 URI；只进入接入队列。
    #[arg(value_name = "OPEN")]
    pub open: Vec<String>,
}

fn parse_prepared(value: &str) -> Result<String, String> {
    if tenon_desktop::restore::valid_id(value) {
        Ok(value.into())
    } else {
        Err("恢复标识无效".into())
    }
}

type SecretFactory = dyn Fn(&Path) -> Result<ProxySecrets, AppError> + Send + Sync;
type NativeFactory = dyn Fn(&Path, &SharedConfig, bool, &Lifecycle) -> Result<NativeServices, AppError>
    + Send
    + Sync;

pub(crate) struct Ports {
    pub notifier: Arc<dyn DesktopNotifier>,
    pub secrets: Box<SecretFactory>,
    pub native: Box<NativeFactory>,
}

impl Ports {
    pub fn system(app: &AppHandle, lifecycle: Arc<Lifecycle>) -> Self {
        let native_app = app.clone();
        Self {
            notifier: Arc::new(SystemNotifier(app.clone())),
            secrets: Box::new(|root| Ok(SecretStore::new(root, CREDENTIAL_SERVICE)?.boxed())),
            native: Box::new(move |root, config, explicit, _| {
                native::system(&native_app, &lifecycle, root, config, explicit)
            }),
        }
    }
}

struct Configured {
    root: PathBuf,
    overrides: Vec<String>,
    ephemeral_webview: bool,
    explicit_root: bool,
    safe_mode: bool,
    config: SharedConfig,
    log_level: LogLevelHandle,
    instance: InstanceId,
}

struct Services {
    account: Arc<AccountService>,
    notify: Arc<NotifyService>,
    ai: Arc<AiService>,
    demo: Arc<DemoService>,
    secrets: Arc<ProxySecrets>,
    translator: Arc<dyn Translator>,
    picked_files: Arc<PickedFileStore>,
}

struct ServicesReady {
    configured: Configured,
    services: Services,
    registry: ModuleRegistry,
    extensions: Extensions,
}

struct DataReady {
    previous: ServicesReady,
    db: Db,
    migrations: MigrationStatus,
    cache: Cache,
    params: ParamStore,
    files: FileStore,
}

struct ModulesReady {
    configured: Configured,
    services: Services,
    registry: Arc<ModuleRegistry>,
    extensions: Extensions,
    db: Db,
    migrations: MigrationStatus,
    cache: Cache,
    params: ParamStore,
    files: FileStore,
}

struct RuntimeReady {
    previous: ModulesReady,
    jobs: JobQueue,
}

pub(crate) struct Running {
    pub state: AppState,
    pub shutdown: Arc<Started>,
}

pub(crate) fn internal(error: impl std::error::Error + Send + Sync + 'static) -> AppError {
    AppError::new(INTERNAL_UNEXPECTED).with_source(error)
}

pub(crate) async fn initialize<R: Runtime>(
    app: &AppHandle<R>,
    options: Options,
    lifecycle: &Lifecycle,
    ports: Ports,
) -> Result<Running, AppError> {
    let mut shutdown = ShutdownStack::default();
    let result = async {
        let configured = configure(app, options, lifecycle, &mut shutdown).await?;
        let services = step("services", configure_services(configured, &ports)).await?;
        let data = open_data(services, &ports, &mut shutdown).await?;
        let modules = step("module-start", start_modules(data, &mut shutdown)).await?;
        let runtime = step("jobs", start_runtime(modules, lifecycle, &mut shutdown)).await?;
        let native = step("native", async {
            lifecycle.window.set_root(
                runtime
                    .previous
                    .configured
                    .root
                    .canonicalize()
                    .map_err(internal)?,
            )?;
            let configured = &runtime.previous.configured;
            let native = Arc::new((ports.native)(
                &configured.root,
                &configured.config,
                configured.explicit_root,
                lifecycle,
            )?);
            let close = native.clone();
            shutdown.push("native", move || async move { close.shutdown() });
            Ok(native)
        })
        .await?;
        step("ipc", async {
            Ok(runtime.into_state(lifecycle, &mut shutdown, native))
        })
        .await
    }
    .await;
    match result {
        Ok(state) => Ok(Running {
            state,
            shutdown: Arc::new(shutdown.into_started()),
        }),
        Err(error) => {
            lifecycle.gate.close_admission();
            shutdown.rollback().await;
            Err(error)
        }
    }
}

async fn configure<R: Runtime>(
    app: &AppHandle<R>,
    options: Options,
    lifecycle: &Lifecycle,
    shutdown: &mut ShutdownStack,
) -> Result<Configured, AppError> {
    let explicit_root =
        options.state_root.is_some() || std::env::var_os("TENON_STATE_ROOT").is_some();
    let ephemeral_webview = cfg!(target_os = "macos") && explicit_root;
    let root = step("root", async {
        tenon_desktop::state_root::resolve(options.state_root, || {
            app.path().app_data_dir().map_err(Into::into)
        })
        .map_err(internal)
    })
    .await?;
    step("restore", async {
        tenon_desktop::restore::before_start(
            &root,
            &root.join("Temp/restore"),
            options.restore_prepared.as_deref(),
        )
    })
    .await?;
    step("startup-record", async { lifecycle.begin_record(&root) }).await?;
    let config = step("config", async {
        config::load(&root, std::env::vars(), &options.overrides).map_err(internal)
    })
    .await?;
    let (guard, log_level) = step("logging", async {
        logging::init(
            &root,
            config.logging(),
            &StartupRecord {
                version: env!("CARGO_PKG_VERSION").into(),
                config_file_exists: config.file_exists(),
                environment_keys: config
                    .source_keys(ConfigSource::Environment)
                    .into_iter()
                    .map(str::to_owned)
                    .collect(),
                command_line_keys: config
                    .source_keys(ConfigSource::CommandLine)
                    .into_iter()
                    .map(str::to_owned)
                    .collect(),
            },
        )
        .map_err(internal)
    })
    .await?;
    shutdown.push("logging", move || async move {
        drop(guard);
        Ok(())
    });
    let instance = step("instance", async { InstanceId::load_or_create(&root) }).await?;
    Ok(Configured {
        root,
        config: Arc::new(Mutex::new(config)),
        log_level,
        instance,
        overrides: options.overrides,
        ephemeral_webview,
        explicit_root,
        safe_mode: options.safe_mode,
    })
}

async fn configure_services(
    configured: Configured,
    ports: &Ports,
) -> Result<ServicesReady, AppError> {
    let settings = Arc::new(SettingsPorts {
        root: configured.root.clone(),
        config: configured.config.clone(),
    });
    let account = Arc::new(AccountService::new(settings.clone(), Timestamp::now));
    let notify = Arc::new(NotifyService::new(
        account.clone(),
        settings,
        ports.notifier.clone(),
        Timestamp::now,
    ));
    let secrets = Arc::new((ports.secrets)(&configured.root)?);
    let proxy_config = configured.config.clone();
    let proxy_secrets = secrets.clone();
    let ai = Arc::new(AiService::new(
        account.clone(),
        Arc::new(move |exact_loopback| {
            ProxySnapshot::read(
                ports::read(&proxy_config)?.proxy(),
                &proxy_secrets,
                exact_loopback,
            )
        }),
    ));
    let preferences = configured.config.clone();
    let demo = Arc::new(DemoService::new(
        account.clone(),
        Arc::new(move || {
            let config = ports::read(&preferences)?;
            Ok(DemoPreferences {
                developer_mode: config.settings().developer_mode.value,
                language: config.language(),
            })
        }),
    ));
    let enabled = ports::read(&configured.config)?
        .modules()
        .iter()
        .map(|(id, item)| (id.clone(), item.enabled))
        .collect();
    let registry = modules::registry(
        account.clone(),
        notify.clone(),
        ai.clone(),
        demo.clone(),
        &enabled,
    )
    .map_err(internal)?;
    registry
        .check_capabilities(&[Capability::Job, Capability::Exchange, Capability::File])
        .map_err(internal)?;
    let picked_files = Arc::new(PickedFileStore::default());
    let extensions = registry
        .freeze(exchange::handlers(
            account.clone(),
            demo.clone(),
            picked_files.clone(),
        ))
        .map_err(internal)?;
    let translator = i18n::translator(configured.config.clone())?;
    Ok(ServicesReady {
        configured,
        registry,
        extensions,
        services: Services {
            account,
            notify,
            ai,
            demo,
            secrets,
            translator,
            picked_files,
        },
    })
}

async fn open_data(
    previous: ServicesReady,
    ports: &Ports,
    shutdown: &mut ShutdownStack,
) -> Result<DataReady, AppError> {
    let config = ports::read(&previous.configured.config)?.clone();
    let root = &previous.configured.root;
    let (db, migrations) = step("database", async {
        let db = Db::connect(config.database(), &previous.services.secrets, root).await?;
        // 本阶段的迁移失败必须自行关库，再让外层回滚之前的阶段。
        match migrate::startup(
            &db,
            &previous.registry.migrations(),
            root,
            config.database().backup_keep,
        )
        .await
        {
            Ok(report) => Ok((db, report)),
            Err(error) => {
                db.close().await;
                Err(error)
            }
        }
    })
    .await?;
    let database = db.clone();
    shutdown.push("database", move || async move {
        database.close().await;
        Ok(())
    });
    let cache = step(
        "cache",
        Cache::connect(config.cache(), &previous.services.secrets),
    )
    .await?;
    let (params, files) = step("stores", async {
        let declarations = previous
            .registry
            .declarations()
            .map(|d| (d.id, d.permissions, d.params))
            .collect::<Vec<_>>();
        let params = ParamStore::new(
            db.clone(),
            cache.clone(),
            (ports.secrets)(root)?,
            &declarations,
        )?;
        let files = FileStore::new(
            db.clone(),
            root,
            previous.configured.instance,
            tenon_framework::file::DEFAULT_MAX_MIB,
            &previous.registry.file_purposes(),
        );
        Ok((params, files))
    })
    .await?;
    Ok(DataReady {
        previous,
        db,
        migrations,
        cache,
        params,
        files,
    })
}

async fn start_modules(
    data: DataReady,
    shutdown: &mut ShutdownStack,
) -> Result<ModulesReady, AppError> {
    let DataReady {
        previous:
            ServicesReady {
                configured,
                services,
                mut registry,
                extensions,
            },
        db,
        migrations,
        cache,
        params,
        files,
    } = data;
    registry
        .start(ModuleContext {
            extensions: &extensions,
            db: &db,
            cache: &cache,
            params: &params,
            files: &files,
            permissions: &registry.permissions(),
            dictionaries: &registry.dictionaries(),
            translator: &services.translator,
        })
        .await?;
    let registry = Arc::new(registry);
    let modules = registry.clone();
    shutdown.push("modules", move || async move { modules.stop().await });
    Ok(ModulesReady {
        configured,
        services,
        registry,
        extensions,
        db,
        migrations,
        cache,
        params,
        files,
    })
}

async fn start_runtime(
    previous: ModulesReady,
    lifecycle: &Lifecycle,
    shutdown: &mut ShutdownStack,
) -> Result<RuntimeReady, AppError> {
    let gate = lifecycle.gate.clone();
    // 在执行器之前登记：逆序为停止执行器、排空 IPC/运行日志许可、停止模块。
    shutdown.push("drain", move || async move {
        gate.close().await;
        Ok(())
    });
    let jobs = JobQueue::new(
        previous.db.clone(),
        previous.extensions.job_handlers().to_vec(),
        previous.registry.schedules(),
        previous.extensions.job_completion_hooks().to_vec(),
        previous.configured.instance,
    )?;
    let config = ports::read(&previous.configured.config)?.jobs();
    let runner = JobRunner::start(
        jobs.clone(),
        previous.extensions.identity().permission_lookup.clone(),
        config,
        lifecycle.gate.clone(),
    )
    .await?;
    shutdown.push("jobs", move || async move { runner.stop().await });
    Ok(RuntimeReady { previous, jobs })
}

impl RuntimeReady {
    fn into_state(
        self,
        lifecycle: &Lifecycle,
        shutdown: &mut ShutdownStack,
        native: Arc<NativeServices>,
    ) -> AppState {
        let ModulesReady {
            configured,
            services,
            registry,
            extensions,
            db,
            migrations,
            cache,
            params,
            files,
        } = self.previous;
        let streams = StreamRegistry::default();
        let active_streams = streams.clone();
        let gate = lifecycle.gate.clone();
        shutdown.push("ipc", move || async move {
            gate.close_admission();
            active_streams.close()
        });
        let identity = extensions.identity();
        AppState {
            native,
            file_ingress: lifecycle.file_ingress.clone(),
            diagnostics_probe: Mutex::new(None),
            data: tenon_desktop::data::DataService::new(
                db.clone(),
                configured.root.clone(),
                configured.root.join("Temp/backup"),
                configured.root.join("Temp/restore"),
            ),
            workbench: tenon_desktop::workbench::WorkbenchStore::new(
                &configured.root,
                &configured.root.join("Temp/workbench"),
            ),
            keyboard: tenon_desktop::keyboard::KeyboardStore::new(&configured.root),
            state_root: configured.root,
            overrides: configured.overrides,
            config: configured.config,
            ephemeral_webview: configured.ephemeral_webview,
            explicit_root: configured.explicit_root,
            safe_mode: configured.safe_mode,
            log_level: configured.log_level,
            instance: configured.instance,
            db,
            migrations,
            cache,
            params,
            files,
            picked_files: services.picked_files,
            modules: registry,
            identity: Identity {
                actor_resolver: identity.actor_resolver.clone(),
                permission_checker: identity.permission_checker.clone(),
                permission_lookup: identity.permission_lookup.clone(),
            },
            jobs: self.jobs,
            account: services.account,
            notify: services.notify,
            ai: services.ai,
            demo: services.demo,
            network_secrets: services.secrets,
            gate: lifecycle.gate.clone(),
            streams,
        }
    }
}

#[cfg(test)]
pub(crate) mod tests;
