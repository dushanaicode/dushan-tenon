//! 原始 Channel 以外的窗口效果：快照、原生询问和共用退出入口。

use std::sync::Arc;
use tauri::Manager;
use tenon_desktop::native::{
    UNAVAILABLE,
    window_controls::{
        CloseChoice, EDIT_UNAVAILABLE, WindowActions, WindowCloseDecision, WindowEvent,
    },
};
use tenon_framework::error::AppError;

use crate::{lifecycle::Lifecycle, state::AppState};

pub(crate) fn snapshot<R: tauri::Runtime>(
    window: &tauri::WebviewWindow<R>,
) -> Result<WindowEvent, AppError> {
    Ok(WindowEvent::State {
        maximized: window
            .is_maximized()
            .map_err(|_| AppError::new(UNAVAILABLE))?,
        focused: window
            .is_focused()
            .map_err(|_| AppError::new(UNAVAILABLE))?,
    })
}

pub(super) struct SystemWindowActions {
    pub app: tauri::AppHandle,
    pub lifecycle: Arc<Lifecycle>,
}

impl WindowActions for SystemWindowActions {
    fn exit(&self) {
        crate::application::request_exit(&self.app, &self.lifecycle);
    }

    fn ask(&self, tray_available: bool) -> Result<(), AppError> {
        use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogResult};
        let translator = crate::i18n::translator(self.app.state::<AppState>().config.clone())?;
        let exit = translator.text("settings.window.close.exit", &Default::default())?;
        let tray = translator.text("settings.window.close.tray", &Default::default())?;
        let cancel = translator.text("kit.cancel", &Default::default())?;
        let buttons = if tray_available {
            MessageDialogButtons::YesNoCancelCustom(exit.clone(), tray.clone(), cancel)
        } else {
            MessageDialogButtons::OkCancelCustom(exit.clone(), cancel)
        };
        let app = self.app.clone();
        self.app
            .dialog()
            .message(translator.text("settings.window.close.prompt", &Default::default())?)
            .title(self.app.package_info().name.clone())
            .buttons(buttons)
            .show_with_result(move |result| {
                let state = app.state::<AppState>();
                let choice = match result {
                    MessageDialogResult::Custom(label) if label == exit => Some(CloseChoice::Exit),
                    MessageDialogResult::Custom(label) if tray_available && label == tray => {
                        Some(CloseChoice::Tray)
                    }
                    _ => None,
                };
                let result = if let Some(action) = choice {
                    state.native.window_controls.decide(
                        &state.native.tray,
                        &state.config,
                        &state.state_root,
                        WindowCloseDecision {
                            action,
                            remember: false,
                        },
                    )
                } else {
                    state.native.window_controls.cancel_native_ask()
                };
                if let Err(error) = result {
                    report_failure(&app, error);
                }
            });
        Ok(())
    }
}

pub(crate) fn report_failure<R: tauri::Runtime>(app: &tauri::AppHandle<R>, error: AppError) {
    (app.state::<AppState>().native.report_failure)(error);
}

pub(super) fn report_system_failure(app: &tauri::AppHandle, error: AppError) {
    use tauri_plugin_dialog::{DialogExt, MessageDialogKind};
    tracing::warn!(reason_code = %error.code(), "关闭窗口失败");
    if error.code() == EDIT_UNAVAILABLE {
        app.dialog()
            .message("有未保存的编辑，请回到窗口处理后重试。\nUnsaved edits are present. Return to the window and save or discard them before exiting.")
            .title(app.package_info().name.clone())
            .kind(MessageDialogKind::Warning).show(|_| {});
        crate::window::show_main(app);
    } else {
        let show = || -> Result<(), AppError> {
            let translator = crate::i18n::translator(app.state::<AppState>().config.clone())?;
            let trace = tenon_framework::id::Id::new().to_string();
            app.dialog()
                .message(translator.text(
                    "settings.tray.hideFailed",
                    &[("traceId".into(), trace.into())].into_iter().collect(),
                )?)
                .title(app.package_info().name.clone())
                .kind(MessageDialogKind::Warning)
                .show(|_| {});
            Ok(())
        };
        if let Err(error) = show() {
            tracing::warn!(reason_code = %error.code(), "关闭错误提示失败");
        }
    }
}
