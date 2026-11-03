//! desktop 更新状态机的 Tauri driver；发行、代理和安装系统调用仅在宿主适配。

use std::{
    path::PathBuf,
    sync::{Arc, Mutex, MutexGuard},
    time::Duration,
};
use tenon_desktop::native::updater::{
    CHECK_FAILED, DOWNLOAD_FAILED, DOWNLOAD_TOO_LARGE, DownloadProgress, INSTALL_FAILED,
    INVALID_RELEASE, ReleaseInfo, SIGNATURE_INVALID, UpdateDriver, UpdateFuture, UpdateState,
    Updater,
};
use tenon_framework::{
    error::{AppError, ErrorCode, INTERNAL_UNEXPECTED},
    network::ProxySnapshot,
    stream::StreamOwner,
};

mod release;
use release::ReleaseConfig;

pub(crate) fn create<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    scratch: PathBuf,
) -> Result<Updater, AppError> {
    let release: Option<ReleaseConfig> = serde_json::from_str(include_str!("../../release.json"))
        .map_err(|_| AppError::new(INVALID_RELEASE))?;
    let Some(release) = release else {
        return Ok(Updater::new(None, scratch));
    };
    release.validate(
        app.config()
            .product_name
            .as_deref()
            .ok_or_else(|| AppError::new(INVALID_RELEASE))?,
    )?;
    let expected = serde_json::json!({
        "endpoints": release.endpoints,
        "pubkey": release.pubkey,
        "requireSignedVersion": true,
        "allowDowngrades": false,
    });
    if app.config().plugins.0.get("updater") != Some(&expected) {
        return Err(AppError::new(INVALID_RELEASE));
    }
    #[cfg(any(windows, target_os = "macos", target_os = "linux"))]
    {
        #[cfg(any(target_os = "macos", target_os = "linux"))]
        {
            let package = if cfg!(target_os = "macos") {
                "app"
            } else {
                "appimage"
            };
            let target =
                tauri_plugin_updater::target().ok_or_else(|| AppError::new(INVALID_RELEASE))?;
            if release.target != format!("{target}-{package}") {
                return Err(AppError::new(INVALID_RELEASE));
            }
        }
        app.plugin(tauri_plugin_updater::Builder::new().build())
            .map_err(|_| AppError::new(INVALID_RELEASE))?;
        Ok(Updater::new(
            Some(Arc::new(SystemUpdater {
                app,
                release,
                update: Mutex::new(None),
            })),
            scratch,
        ))
    }
    #[cfg(not(any(windows, target_os = "macos", target_os = "linux")))]
    Err(AppError::new(INVALID_RELEASE))
}

#[cfg(any(windows, target_os = "macos", target_os = "linux"))]
struct SystemUpdater<R: tauri::Runtime> {
    app: tauri::AppHandle<R>,
    release: ReleaseConfig,
    update: Mutex<Option<tauri_plugin_updater::Update>>,
}

impl<R: tauri::Runtime> SystemUpdater<R> {
    fn candidate(&self) -> Result<MutexGuard<'_, Option<tauri_plugin_updater::Update>>, AppError> {
        self.update
            .lock()
            .map_err(|_| AppError::new(INTERNAL_UNEXPECTED))
    }
}

#[cfg(any(windows, target_os = "macos", target_os = "linux"))]
pub(crate) fn proxy_policy(snapshot: Arc<ProxySnapshot>) -> tauri_plugin_updater::OnBeforeRequest {
    use secrecy::ExposeSecret;
    use tauri_plugin_updater::{Policy, Proxy};
    let proxy = match snapshot.as_ref() {
        ProxySnapshot::Direct => None,
        ProxySnapshot::Manual {
            endpoint,
            credentials,
        } => {
            let endpoint = endpoint.clone();
            let mut proxy = Proxy::custom(move |target| {
                if tenon_framework::network::is_exact_loopback(target.as_str()) {
                    None
                } else {
                    Some(endpoint.clone())
                }
            });
            if let Some(credentials) = credentials {
                proxy = proxy.basic_auth(
                    credentials.username.expose_secret(),
                    credentials.password.expose_secret(),
                );
            }
            Some(proxy)
        }
    };
    Arc::new(move |client| {
        let client = client.no_proxy().redirect(Policy::none());
        match &proxy {
            Some(proxy) => client.proxy(proxy.clone()),
            None => client,
        }
    })
}

fn plugin_error(error: tauri_plugin_updater::Error, network: ErrorCode) -> AppError {
    use tauri_plugin_updater::Error;
    AppError::new(match error {
        Error::DownloadTooLarge => DOWNLOAD_TOO_LARGE,
        Error::Minisign(_)
        | Error::Base64(_)
        | Error::SignatureUtf8(_)
        | Error::SignedVersionMismatch { .. }
        | Error::MissingSignedVersion => SIGNATURE_INVALID,
        Error::Reqwest(_) | Error::Network(_) | Error::ReleaseNotFound => network,
        _ => INVALID_RELEASE,
    })
}

#[cfg(any(windows, target_os = "macos", target_os = "linux"))]
impl<R: tauri::Runtime> UpdateDriver for SystemUpdater<R> {
    fn check(
        &self,
        proxy: Arc<ProxySnapshot>,
        scratch: PathBuf,
    ) -> UpdateFuture<'_, Option<ReleaseInfo>> {
        use tauri_plugin_updater::UpdaterExt;
        Box::pin(async move {
            *self.candidate()? = None;
            let policy = proxy_policy(proxy);
            let updater = self
                .app
                .updater_builder()
                .target(&self.release.target)
                .scratch_root(scratch)
                .map_err(|error| plugin_error(error, CHECK_FAILED))?
                // InstallPlan 已等待完整 shutdown 和 cleanup；覆盖插件默认 cleanup，避免重复。
                .on_before_exit(|| {})
                .timeout(Duration::from_secs(30))
                .configure_client(move |client| policy(client))
                .build()
                .map_err(|error| plugin_error(error, CHECK_FAILED))?;
            let update = updater
                .check()
                .await
                .map_err(|error| plugin_error(error, CHECK_FAILED))?;
            let Some(mut update) = update else {
                return Ok(None);
            };
            self.release.download_url(&update.download_url)?;
            update.timeout = Some(Duration::from_secs(300));
            let info = ReleaseInfo {
                version: update.version.clone(),
                published_at: update
                    .raw_json
                    .get("pub_date")
                    .and_then(|date| date.as_str())
                    .map(str::to_owned),
                notes: update.body.clone().unwrap_or_default(),
            };
            *self.candidate()? = Some(update);
            Ok(Some(info))
        })
    }

    fn download(&self, progress: DownloadProgress) -> UpdateFuture<'_, Vec<u8>> {
        Box::pin(async move {
            let update = self
                .candidate()?
                .as_ref()
                .ok_or_else(|| AppError::new(INVALID_RELEASE))?
                .clone();
            update
                .download(move |length, total| progress(length, total), || {})
                .await
                .map_err(|error| plugin_error(error, DOWNLOAD_FAILED))
        })
    }

    fn install(&self, bytes: Vec<u8>) -> Result<(), AppError> {
        let update = self
            .candidate()?
            .take()
            .ok_or_else(|| AppError::new(INVALID_RELEASE))?;
        update
            .install(bytes)
            .map_err(|_| AppError::new(INSTALL_FAILED))?;
        #[cfg(any(target_os = "macos", target_os = "linux"))]
        self.app.request_restart();
        Ok(())
    }
}

pub(crate) async fn check(
    state: &crate::state::AppState,
    owner: StreamOwner,
    trace: &str,
) -> Result<UpdateState, AppError> {
    tenon_desktop::native::window_controls::require_main(&owner.scope)?;
    state.require_owner(owner.actor)?;
    state
        .native
        .updater
        .check(
            owner,
            || {
                let config = crate::ports::read(&state.config)?;
                ProxySnapshot::read(config.proxy(), state.network_secrets.as_ref(), false)
                    .map(Arc::new)
            },
            trace,
        )
        .await
}

pub(crate) fn check_on_start<R: tauri::Runtime>(app: tauri::AppHandle<R>) -> Result<(), AppError> {
    use tauri::Manager;
    let state = app.state::<crate::state::AppState>();
    if !state.native.updater.configured()
        || !crate::ports::read(&state.config)?
            .native_settings()
            .check_on_start
            .value
    {
        return Ok(());
    }
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_secs(30)).await;
        let state = app.state::<crate::state::AppState>();
        let _ =
            tenon_framework::ipc::execute(state.inner(), "app_update_check", |state| async move {
                check(
                    &state,
                    StreamOwner {
                        actor: state.execution.actor,
                        scope: "main".into(),
                    },
                    &state.execution.trace_id,
                )
                .await
            })
            .await;
    });
    Ok(())
}
