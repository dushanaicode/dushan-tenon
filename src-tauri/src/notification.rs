use tauri::{AppHandle, Manager, Runtime};
use tauri_plugin_notification::NotificationExt;
use tenon_framework::error::AppError;
use tenon_module_notify::{DESKTOP_FAILED, DesktopNotifier};

pub(crate) struct SystemNotifier<R: Runtime>(pub AppHandle<R>);

impl<R: Runtime> DesktopNotifier for SystemNotifier<R> {
    fn send(&self, title: &str, body: &str) -> Result<(), AppError> {
        self.0
            .notification()
            .builder()
            .title(title)
            .body(body)
            .show()
            .map_err(|_| AppError::new(DESKTOP_FAILED))
    }

    fn window_focused(&self) -> bool {
        match self
            .0
            .get_webview_window("main")
            .map(|window| window.is_focused())
        {
            Some(Ok(focused)) => focused,
            _ => {
                tracing::warn!(reason_code = "window_focus_unavailable", "抑制桌面通知");
                true
            }
        }
    }
}
