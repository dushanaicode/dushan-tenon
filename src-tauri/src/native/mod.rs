//! D3 原生策略的系统适配；生产对象只在入口注入，测试使用相同装配和替身。

use std::{path::Path, sync::Arc};
use tauri::{AppHandle, Manager};
use tenon_desktop::native::{
    UNAVAILABLE,
    autostart::Autostart,
    opener::{KnownTargets, OPEN_UNAVAILABLE},
    shortcuts::{ShortcutActivation, ShortcutAdapter, Shortcuts},
    tray::Tray,
    updater::Updater,
    window_controls::WindowControls,
};
use tenon_framework::error::AppError;

use crate::{
    lifecycle::Lifecycle,
    ports,
    state::{AppState, SharedConfig},
};

#[cfg(target_os = "linux")]
mod autostart_linux;
#[cfg(target_os = "macos")]
mod autostart_macos;
#[cfg(any(windows, test))]
mod autostart_registry;
mod autostart_scope;
pub(crate) mod chrome;
mod shortcuts;
pub(crate) mod tray;
pub(crate) mod window_controls;
pub(crate) mod window_state;

pub(crate) struct NativeServices {
    pub chrome: Arc<dyn chrome::WindowChrome>,
    pub window_controls: Arc<WindowControls>,
    pub tray: Arc<Tray>,
    pub autostart: Arc<Autostart>,
    pub shortcuts: Arc<Shortcuts>,
    pub known_targets: KnownTargets,
    pub window_state: Arc<tauri_plugin_window_state::WindowState>,
    pub updater: Updater,
    pub report_failure: Arc<dyn Fn(AppError) + Send + Sync>,
}

impl NativeServices {
    pub fn shutdown(&self) -> Result<(), AppError> {
        // 任一失败都继续释放其余资源，最终返回首个安全错误。
        let mut failure = None;
        for result in [
            self.window_controls.shutdown(),
            self.tray.shutdown(),
            self.shortcuts.shutdown(),
            self.window_state
                .shutdown()
                .map_err(|_| AppError::new(window_state::WRITE_FAILED)),
        ] {
            if let Err(error) = result {
                tracing::warn!(reason_code = %error.code(), "原生资源收尾失败");
                failure.get_or_insert(error);
            }
        }
        failure.map_or(Ok(()), Err)
    }
}

pub(crate) fn system(
    app: &AppHandle,
    lifecycle: &Arc<Lifecycle>,
    root: &Path,
    shared_config: &SharedConfig,
    explicit_root: bool,
) -> Result<NativeServices, AppError> {
    use tauri_plugin_global_shortcut::ShortcutState;
    use tauri_plugin_opener::OpenerExt;

    let config = ports::read(shared_config)?.native_settings();
    let translator = crate::i18n::translator(shared_config.clone())?;
    let tray = tray::SystemTray::new(app.clone(), lifecycle.clone(), translator.as_ref())?;
    let window_state = window_state::create(root, config.restore_state.value)?;
    app.plugin(tauri_plugin_window_state::Builder::new(window_state.clone()).build())
        .map_err(|_| AppError::new(UNAVAILABLE))?;
    app.plugin(
        tauri_plugin_opener::Builder::new()
            .open_js_links_on_click(false)
            .build(),
    )
    .map_err(|_| AppError::new(OPEN_UNAVAILABLE))?;
    let opener = app.clone();
    let known_targets = KnownTargets::new(
        root,
        Arc::new(move |path| {
            let path = path
                .to_str()
                .ok_or_else(|| AppError::new(OPEN_UNAVAILABLE))?;
            opener
                .opener()
                .open_path(path, None::<&str>)
                .map_err(|_| AppError::new(OPEN_UNAVAILABLE))
        }),
    )?;
    let autostart = autostart_scope::create(app, root, explicit_root)?;
    let activation = Arc::new(ShortcutActivation::default());
    let adapter = if shortcuts::system_supported() {
        let callback = activation.clone();
        let lifecycle = lifecycle.clone();
        app.plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(move |app, key, event| {
                    if callback.pressed(key.id(), event.state == ShortcutState::Pressed) {
                        match lifecycle.window.request_show(None) {
                            Ok(true) => crate::window::show_main(app),
                            Ok(false) => {}
                            Err(error) => {
                                tracing::warn!(reason_code = %error.code(), "快捷键显示失败")
                            }
                        }
                    }
                })
                .build(),
        )
        .map_err(|_| AppError::new(UNAVAILABLE))?;
        Some(Arc::new(shortcuts::SystemShortcuts(app.clone())) as Arc<dyn ShortcutAdapter>)
    } else {
        None
    };
    // 注册键之后不再执行可失败的构造，取得资源即由 native 关闭栈负责。
    let shortcuts = Arc::new(Shortcuts::new(adapter, activation, &config.show_main.value));
    let feedback = app.clone();
    Ok(NativeServices {
        chrome: Arc::new(chrome::SystemWindowChrome(app.clone())),
        window_controls: Arc::new(WindowControls::new(
            lifecycle.gate.clone(),
            Arc::new(window_controls::SystemWindowActions {
                app: app.clone(),
                lifecycle: lifecycle.clone(),
            }),
        )),
        tray: Arc::new(Tray::new(Some(Arc::new(tray)))),
        autostart: Arc::new(autostart),
        shortcuts,
        known_targets,
        window_state,
        // 未配置发行源的真实状态；H4 将注入发行配置与 SystemUpdater。
        updater: Updater::new(None, root.join("Temp/updates")),
        report_failure: Arc::new(move |error| {
            window_controls::report_system_failure(&feedback, error)
        }),
    })
}

pub(crate) fn close_requested<R: tauri::Runtime>(app: &AppHandle<R>) -> Result<(), AppError> {
    let state = app.state::<AppState>();
    state
        .native
        .window_controls
        .close_requested(&state.native.tray)
}

#[cfg(test)]
pub(crate) mod tests;
