use std::{
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
    time::Duration,
};
use tauri::{
    AppHandle, Manager, Runtime, WebviewWindow, WebviewWindowBuilder, webview::PageLoadEvent,
};
use tenon_desktop::{
    config::{AppSettings, Titlebar},
    native::instance::secondary_root,
};
use tenon_framework::error::{AppError, INTERNAL_UNEXPECTED};

use crate::{boot::internal, lifecycle::Lifecycle, ports, state::AppState};
use clap::Parser;

const REVEAL_DEADLINE: Duration = Duration::from_secs(10);

#[derive(Default)]
pub(crate) struct WindowReveal {
    armed: AtomicBool,
    loaded: AtomicBool,
    shown: AtomicBool,
}

impl WindowReveal {
    fn show(
        &self,
        closing: bool,
        show: impl FnOnce() -> Result<(), AppError>,
    ) -> Result<bool, AppError> {
        if closing
            || !self.armed.load(Ordering::Acquire)
            || self
                .shown
                .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
                .is_err()
        {
            return Ok(false);
        }
        if let Err(error) = show() {
            self.shown.store(false, Ordering::Release);
            return Err(error);
        }
        Ok(true)
    }
}

pub(crate) fn initialization_script(
    settings: &AppSettings,
    origin: &str,
    notice: &str,
) -> Result<String, AppError> {
    let settings = serde_json::to_string(settings).map_err(internal)?;
    let origin = serde_json::to_string(origin).map_err(internal)?;
    Ok(format!(
        r#"(() => {{
  if (window.top !== window || window.location.protocol + '//' + window.location.host !== {origin}) return;
  const settings = {settings};
  window.__TENON_INITIAL_SETTINGS__ = {{ settings }};
  window.__TENON_RECOVERY_NOTICE__ = {notice};
  const mode = settings.theme.value;
  const dark = mode === 'dark' || (mode === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  const apply = () => {{
    const root = document.documentElement;
    if (!root) return false;
    root.classList.toggle('dark', dark);
    root.style.colorScheme = dark ? 'dark' : 'light';
    return true;
  }};
  if (!apply()) {{
    const observer = new MutationObserver(() => {{ if (apply()) observer.disconnect(); }});
    observer.observe(document, {{ childList: true }});
  }}
}})();"#
    ))
}

pub(crate) fn setup_window<R: Runtime>(
    app: &AppHandle<R>,
    lifecycle: Arc<Lifecycle>,
) -> Result<(), AppError> {
    let state = app.state::<AppState>();
    let settings = ports::read(&state.config)?.settings();
    let origin = if tauri::is_dev() {
        app.config()
            .build
            .dev_url
            .as_ref()
            .ok_or_else(|| AppError::new(INTERNAL_UNEXPECTED))?
            .origin()
            .ascii_serialization()
    } else if cfg!(windows) {
        "http://tauri.localhost".into()
    } else {
        "tauri://localhost".into()
    };
    let script = initialization_script(&settings, &origin, &lifecycle.notice_json()?)?;
    let mut config = app
        .config()
        .app
        .windows
        .iter()
        .find(|window| window.label == "main")
        .ok_or_else(|| AppError::new(INTERNAL_UNEXPECTED))?
        .clone();
    if state.safe_mode {
        config.url = tauri::WebviewUrl::App("index.html?recovery=basic".into());
    }
    let reveal = Arc::new(WindowReveal::default());
    let loaded_reveal = reveal.clone();
    let loaded_lifecycle = lifecycle.clone();
    let builder = WebviewWindowBuilder::from_config(app, &config)
        .map_err(internal)?
        .decorations(cfg!(target_os = "macos") || settings.titlebar.value == Titlebar::Native)
        .visible(false)
        .data_directory(state.state_root.join("webview"));
    // 显式隔离运行在 macOS 也不得使用用户 Library 中的 WebView 存储。
    #[cfg(target_os = "macos")]
    let builder = builder
        .incognito(state.ephemeral_webview)
        .title_bar_style(crate::native::chrome::mac_titlebar_style(
            settings.titlebar.value,
        ))
        .hidden_title(settings.titlebar.value == Titlebar::Hidden);
    let builder = builder
        .initialization_script(script)
        .on_page_load(move |window, payload| {
            if matches!(payload.event(), PageLoadEvent::Finished) {
                loaded_reveal.loaded.store(true, Ordering::Release);
                reveal_main(&window, &loaded_reveal, &loaded_lifecycle, false);
            }
        });
    let window = crate::native::chrome::create_hidden_window(
        state.native.chrome.as_ref(),
        settings.theme.value,
        settings.titlebar.value,
        || builder.build().map_err(internal),
    )?;
    state.native.tray.start(&state.config)?;
    reveal.armed.store(true, Ordering::Release);
    if reveal.loaded.load(Ordering::Acquire) {
        reveal_main(&window, &reveal, &lifecycle, false);
    }
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(REVEAL_DEADLINE).await;
        reveal_main(&window, &reveal, &lifecycle, true);
    });
    Ok(())
}

fn reveal_main<R: Runtime>(
    window: &WebviewWindow<R>,
    reveal: &WindowReveal,
    lifecycle: &Lifecycle,
    deadline: bool,
) {
    match reveal.show(lifecycle.gate.is_closing(), || {
        window.show().map_err(internal)
    }) {
        Ok(true) => {
            if deadline {
                tracing::warn!("主窗口加载超过 10 秒，已触发显示");
            }
            match lifecycle.window.ready() {
                Ok(true) => show_main(window.app_handle()),
                Ok(false) => {}
                Err(error) => tracing::warn!(code = %error.code(), "主窗口显示意图未处理"),
            }
        }
        Ok(false) => {}
        Err(error) => tracing::warn!(code = %error.code(), "主窗口显示失败"),
    }
}

pub(crate) fn show_main<R: Runtime>(app: &AppHandle<R>) {
    if let Some(window) = app.get_webview_window("main")
        && window.unminimize().and_then(|()| window.show()).is_err()
    {
        tracing::warn!(reason_code = "window_show_failed", "主窗口激活失败");
    }
}

pub(crate) fn secondary_launch<R: Runtime>(
    app: &AppHandle<R>,
    args: Vec<String>,
    cwd: String,
    lifecycle: &Lifecycle,
) {
    if lifecycle.gate.is_closing() {
        return;
    }
    match secondary_root(&args, &cwd) {
        Ok(root) => {
            if let Some(state) = app.try_state::<AppState>()
                && let Some(requested) = &root
            {
                match state.state_root.canonicalize() {
                    Ok(current) if requested != &current => return,
                    Ok(_) => {}
                    Err(_) => {
                        tracing::warn!(reason_code = "state_root_unavailable", "忽略二次启动");
                        return;
                    }
                }
            }
            let show = lifecycle.window.request_show(root.clone());
            match crate::boot::Options::try_parse_from(args) {
                Ok(request) => crate::file_ingress::enqueue_arguments(
                    app,
                    lifecycle,
                    &request.open,
                    std::path::Path::new(&cwd),
                    root,
                ),
                Err(_) => {
                    tracing::warn!(reason_code = "invalid_open_arguments", "忽略文件打开请求")
                }
            }
            match show {
                Ok(true) => show_main(app),
                Ok(false) => {}
                Err(error) => tracing::warn!(code = %error.code(), "忽略二次启动"),
            }
        }
        Err(reason_code) => tracing::warn!(reason_code, "忽略二次启动"),
    }
}

#[cfg(test)]
mod tests;
