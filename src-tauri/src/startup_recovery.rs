//! 启动故障的原生提示、事件循环等待及退出后的受控进程重启。

use std::{
    ffi::OsString,
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    },
};
use tauri::Runtime;
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
use tenon_desktop::startup_recovery::{failure_notice, failure_summary};
use tenon_framework::error::{AppError, INTERNAL_UNEXPECTED};

use crate::lifecycle::Lifecycle;

#[derive(Default)]
pub(crate) struct RecoveryUi {
    waiting: AtomicBool,
    restart: Mutex<Option<Vec<OsString>>>,
}

impl RecoveryUi {
    pub fn waiting(&self) -> bool {
        self.waiting.load(Ordering::Acquire)
    }

    pub fn schedule_restart(&self, args: Vec<OsString>) -> Result<(), AppError> {
        let mut restart = self
            .restart
            .lock()
            .map_err(|_| AppError::new(INTERNAL_UNEXPECTED))?;
        if restart.is_some() {
            return Err(AppError::new(INTERNAL_UNEXPECTED));
        }
        *restart = Some(args);
        Ok(())
    }

    /// 仅在 run_return 返回、单实例插件释放后调用。测试注入替身，不启动进程。
    pub fn restart_with(
        &self,
        spawn: impl FnOnce(Vec<OsString>) -> std::io::Result<()>,
    ) -> Result<(), AppError> {
        if let Some(args) = self
            .restart
            .lock()
            .map_err(|_| AppError::new(INTERNAL_UNEXPECTED))?
            .take()
        {
            spawn(args).map_err(crate::boot::internal)?;
        }
        Ok(())
    }
}

pub(crate) fn show<R: Runtime>(
    app: &tauri::AppHandle<R>,
    lifecycle: &Arc<Lifecycle>,
    error: &AppError,
) {
    present_with(
        app,
        lifecycle,
        error,
        std::env::args_os().skip(1).collect(),
        |summary, fatal, reply| {
            let dialog = app.dialog().message(summary).kind(MessageDialogKind::Error);
            if fatal {
                dialog
                    .title("恢复启动失败 / Restore startup failed")
                    .show(move |_| reply(false));
            } else {
                dialog
                    .title(app.package_info().name.clone())
                    .buttons(MessageDialogButtons::OkCancelCustom(
                        "重试 / Retry".into(),
                        "退出 / Exit".into(),
                    ))
                    .show(reply);
            }
        },
    );
}

pub(crate) fn present_with<R: Runtime>(
    app: &tauri::AppHandle<R>,
    lifecycle: &Arc<Lifecycle>,
    error: &AppError,
    original: Vec<OsString>,
    present: impl FnOnce(String, bool, Box<dyn FnOnce(bool) + Send>),
) {
    lifecycle.fail(error);
    let fatal = error.code().as_str().starts_with("app.backup.");
    let summary = if fatal {
        format!(
            "恢复未完成，已停止启动。请保留状态目录与 Temp 中的恢复证据，联系维护者检查；不要删除数据库或创建空库。\nRestore could not complete. Startup stopped; preserve the restore evidence.\nCode: {}\nTrace: {}",
            error.code(),
            tenon_framework::id::Id::new()
        )
    } else {
        match failure_summary(&failure_notice(error)) {
            Ok(summary) => summary,
            Err(error) => {
                tracing::error!(code = %error.code(), "启动故障提示生成失败");
                crate::application::request_exit(app, lifecycle);
                return;
            }
        }
    };
    eprintln!("{summary}");
    lifecycle.recovery_ui.waiting.store(true, Ordering::Release);
    let app = app.clone();
    let lifecycle = lifecycle.clone();
    present(
        summary,
        fatal,
        Box::new(move |retry| {
            if !fatal
                && retry
                && let Err(error) = lifecycle.recovery_ui.schedule_restart(original)
            {
                tracing::error!(code = %error.code(), "启动重试未安排");
            }
            lifecycle
                .recovery_ui
                .waiting
                .store(false, Ordering::Release);
            crate::application::request_exit(&app, &lifecycle);
        }),
    );
}

#[cfg(test)]
mod tests;
