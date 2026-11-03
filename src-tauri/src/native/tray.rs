//! 托盘图标与菜单事件；策略和设置事务由 desktop::native::tray 承担。

use tauri::Manager;
use tenon_desktop::native::{
    UNAVAILABLE,
    tray::{TrayAction, TrayAdapter},
};
use tenon_framework::error::AppError;

use crate::state::AppState;

pub(super) struct SystemTray {
    app: tauri::AppHandle,
    lifecycle: std::sync::Arc<crate::lifecycle::Lifecycle>,
    show: String,
    exit: String,
}

impl SystemTray {
    pub fn new(
        app: tauri::AppHandle,
        lifecycle: std::sync::Arc<crate::lifecycle::Lifecycle>,
        translator: &dyn tenon_framework::i18n::Translator,
    ) -> Result<Self, AppError> {
        // 创建/删除图标由 desktop 的配置事务调用；适配器不能重入配置锁。
        Ok(Self {
            app,
            lifecycle,
            show: translator.text("settings.tray.show", &Default::default())?,
            exit: translator.text("settings.tray.exit", &Default::default())?,
        })
    }
}

impl TrayAdapter for SystemTray {
    fn create(&self) -> Result<(), AppError> {
        use tauri::{
            menu::{Menu, MenuItem},
            tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
        };
        let build = || -> Result<(), Box<dyn std::error::Error>> {
            let menu_lifecycle = self.lifecycle.clone();
            let click_lifecycle = self.lifecycle.clone();
            let show = MenuItem::with_id(&self.app, "tray.show", &self.show, true, None::<&str>)?;
            let exit = MenuItem::with_id(&self.app, "tray.exit", &self.exit, true, None::<&str>)?;
            let menu = Menu::with_items(&self.app, &[&show, &exit])?;
            TrayIconBuilder::with_id("main.tray")
                .icon(tauri::image::Image::from_bytes(include_bytes!(
                    "../../icons/tray@2x.png"
                ))?)
                .icon_as_template(cfg!(target_os = "macos"))
                .menu(&menu)
                .show_menu_on_left_click(!cfg!(windows))
                .on_menu_event(move |app, event| {
                    if let Some(action) = TrayAction::from_menu(event.id.as_ref()) {
                        dispatch(app, action, &menu_lifecycle.window);
                    }
                })
                .on_tray_icon_event(move |tray, event| {
                    if matches!(
                        event,
                        TrayIconEvent::Click {
                            button: MouseButton::Left,
                            button_state: MouseButtonState::Up,
                            ..
                        }
                    ) {
                        dispatch(tray.app_handle(), TrayAction::Show, &click_lifecycle.window);
                    }
                })
                .build(&self.app)?;
            Ok(())
        };
        build().map_err(|_| AppError::new(UNAVAILABLE))
    }

    fn remove(&self) -> Result<(), AppError> {
        let app = self.app.clone();
        let (sender, receiver) = std::sync::mpsc::channel();
        self.app
            .run_on_main_thread(move || {
                drop(app.remove_tray_by_id("main.tray"));
                let _ = sender.send(());
            })
            .map_err(|_| AppError::new(UNAVAILABLE))?;
        receiver.recv().map_err(|_| AppError::new(UNAVAILABLE))
    }

    fn show_main(&self) -> Result<(), AppError> {
        let window = self
            .app
            .get_webview_window("main")
            .ok_or_else(|| AppError::new(UNAVAILABLE))?;
        window
            .unminimize()
            .and_then(|()| window.show())
            .map_err(|_| AppError::new(UNAVAILABLE))
    }

    fn hide_main(&self) -> Result<(), AppError> {
        self.app
            .get_webview_window("main")
            .ok_or_else(|| AppError::new(UNAVAILABLE))?
            .hide()
            .map_err(|_| AppError::new(UNAVAILABLE))
    }
}

pub(crate) fn dispatch<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    action: TrayAction,
    intent: &tenon_desktop::native::instance::MainWindowIntent,
) {
    let state = app.state::<AppState>();
    if state.gate.is_closing() {
        return;
    }
    action.dispatch(
        || match intent.request_show(None) {
            Ok(true) => {
                crate::window::show_main(app);
                if let Some(window) = app.get_webview_window("main")
                    && window.set_focus().is_err()
                {
                    tracing::warn!(reason_code = "window_focus_failed", "托盘恢复窗口焦点失败");
                }
            }
            Ok(false) => {}
            Err(error) => tracing::warn!(reason_code = %error.code(), "托盘显示意图失败"),
        },
        || {
            if let Err(error) = state.native.window_controls.exit_requested() {
                super::window_controls::report_failure(app, error);
            }
        },
    );
}
