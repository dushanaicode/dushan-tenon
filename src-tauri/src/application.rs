use crate::{boot, commands, native, ports, window};
use clap::Parser;
use std::sync::Arc;
use tauri::{Manager, RunEvent, Runtime, WindowEvent};
use tenon_framework::error::AppError;

use crate::boot::{Options, Ports};
use crate::lifecycle::Lifecycle;
use crate::state::AppState;

pub fn run() -> tauri::Result<i32> {
    let options = Options::parse();
    let lifecycle = Arc::new(Lifecycle::new());
    match build_application(options, lifecycle.clone()) {
        Ok(app) => {
            let events = lifecycle.clone();
            let code = app.run_return(move |app, event| handle_run_event(app, event, &events));
            tauri::async_runtime::block_on(lifecycle.shutdown());
            Ok(if lifecycle.exit_code() != 0 {
                lifecycle.exit_code()
            } else {
                code
            })
        }
        Err(error) => {
            lifecycle.fail(&AppError::new(tenon_framework::error::INTERNAL_UNEXPECTED));
            let notice = tenon_desktop::startup_recovery::failure_notice(&error);
            if let Ok(summary) = tenon_desktop::startup_recovery::failure_summary(&notice) {
                eprintln!("{summary}");
            }
            tauri::async_runtime::block_on(lifecycle.shutdown());
            Err(error)
        }
    }
}

fn build_application(options: Options, lifecycle: Arc<Lifecycle>) -> tauri::Result<tauri::App> {
    let secondary = lifecycle.clone();
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(move |app, args, cwd| {
            window::secondary_launch(app, args, cwd, &secondary);
        }))
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(commands::handler())
        .on_page_load(|webview, payload| {
            if matches!(payload.event(), tauri::webview::PageLoadEvent::Started)
                && let Some(state) = webview.try_state::<AppState>()
            {
                if let Err(error) = state.streams.cancel_scope(webview.label()) {
                    tracing::warn!(code = %error.code(), "页面流取消失败");
                }
                if webview.label() == "main"
                    && let Err(error) = state.native.window_controls.page_loading()
                {
                    tracing::warn!(reason_code = %error.code(), "窗口订阅释放失败");
                }
            }
        })
        .setup(move |app| {
            let result = tauri::async_runtime::block_on(boot::initialize(
                app.handle(),
                options,
                &lifecycle,
                Ports::system(app.handle(), lifecycle.clone()),
            ));
            match result {
                Ok(running) => {
                    if let Err(error) = lifecycle.install(running.shutdown.clone()) {
                        tauri::async_runtime::block_on(running.shutdown.shutdown());
                        present_startup_failure(app.handle(), &lifecycle, &error);
                    } else if !app.manage(running.state) {
                        present_startup_failure(
                            app.handle(),
                            &lifecycle,
                            &AppError::new(tenon_framework::error::INTERNAL_UNEXPECTED),
                        );
                    } else if let Err(error) = window::setup_window(app.handle(), lifecycle.clone())
                    {
                        present_startup_failure(app.handle(), &lifecycle, &error);
                    }
                }
                Err(error) => present_startup_failure(app.handle(), &lifecycle, &error),
            }
            Ok(())
        })
        .build(tauri::generate_context!())
}

pub(crate) fn present_startup_failure<R: Runtime>(
    app: &tauri::AppHandle<R>,
    lifecycle: &Arc<Lifecycle>,
    error: &AppError,
) {
    lifecycle.fail(error);
    tracing::error!(code = %error.code(), "宿主启动失败");
    let notice = tenon_desktop::startup_recovery::failure_notice(error);
    if let Ok(summary) = tenon_desktop::startup_recovery::failure_summary(&notice) {
        eprintln!("{summary}");
    }
    request_exit(app, lifecycle);
}

pub(crate) fn request_exit<R: Runtime>(app: &tauri::AppHandle<R>, lifecycle: &Arc<Lifecycle>) {
    lifecycle.exit.begin();
    let app = app.clone();
    let lifecycle = lifecycle.clone();
    tauri::async_runtime::spawn(async move {
        if lifecycle.exit.request_exit(lifecycle.shutdown()).await {
            app.exit(lifecycle.exit_code());
        }
    });
}

pub(crate) fn handle_window_event<R: Runtime>(
    app: &tauri::AppHandle<R>,
    label: &str,
    event: WindowEvent,
    lifecycle: &Arc<Lifecycle>,
) {
    match event {
        WindowEvent::CloseRequested { api, .. } if label == "main" => {
            api.prevent_close();
            if app.try_state::<AppState>().is_some() {
                if let Err(error) = native::close_requested(app) {
                    native::window_controls::report_failure(app, error);
                }
            } else {
                request_exit(app, lifecycle);
            }
        }
        WindowEvent::Destroyed => {
            if let Some(state) = app.try_state::<AppState>() {
                if let Err(error) = state.streams.cancel_scope(label) {
                    tracing::warn!(code = %error.code(), "窗口流取消失败");
                }
                if label == "main"
                    && let Err(error) = state.native.window_controls.page_loading()
                {
                    tracing::warn!(reason_code = %error.code(), "窗口订阅释放失败");
                }
            }
        }
        WindowEvent::ThemeChanged(_) if label == "main" => {
            if let Some(state) = app.try_state::<AppState>() {
                match ports::read(&state.config).map(|config| config.settings()) {
                    Ok(saved) => {
                        native::chrome::system_theme_changed(state.native.chrome.as_ref(), &saved)
                    }
                    Err(error) => tracing::warn!(reason_code = %error.code(), "原生明暗读取失败"),
                }
            }
        }
        WindowEvent::Moved(position) if label == "main" => {
            if let Some(state) = app.try_state::<AppState>()
                && let Err(error) = state.native.window_controls.moved(position.x, position.y)
            {
                tracing::warn!(reason_code = %error.code(), "窗口移动推送失败");
            }
        }
        WindowEvent::Resized(_) | WindowEvent::Focused(_) if label == "main" => {
            if let Some(window) = app.get_webview_window("main")
                && let Some(state) = app.try_state::<AppState>()
                && let Err(error) = native::window_controls::snapshot(&window)
                    .and_then(|snapshot| state.native.window_controls.changed(snapshot))
            {
                tracing::warn!(reason_code = %error.code(), "窗口状态推送失败");
            }
        }
        _ => {}
    }
}

fn handle_run_event<R: Runtime>(
    app: &tauri::AppHandle<R>,
    event: RunEvent,
    lifecycle: &Arc<Lifecycle>,
) {
    match event {
        RunEvent::ExitRequested { api, .. } if !lifecycle.exit.is_finished() => {
            api.prevent_exit();
            if let Some(state) = app.try_state::<AppState>()
                && !lifecycle.gate.is_closing()
            {
                if let Err(error) = state.native.window_controls.exit_requested() {
                    native::window_controls::report_failure(app, error);
                }
            } else {
                request_exit(app, lifecycle);
            }
        }
        RunEvent::WindowEvent { label, event, .. } => {
            handle_window_event(app, &label, event, lifecycle)
        }
        _ => {}
    }
}
