//! journal 已接受后的唯一退出路径；重启参数不含外部文件路径。

use std::{ffi::OsString, path::Path, sync::Arc};
use tauri::{Manager, Runtime};
use tenon_framework::error::AppError;

pub(crate) fn restart_args(
    root: &Path,
    explicit: bool,
    overrides: &[String],
    id: &str,
) -> Result<Vec<OsString>, AppError> {
    tenon_desktop::data::validate_operation_id(id)?;
    let mut args = Vec::new();
    if explicit {
        args.extend([OsString::from("--state-root"), root.as_os_str().to_owned()]);
    }
    args.extend(["--restore-prepared".into(), id.into()]);
    for value in overrides {
        args.extend(["--set".into(), value.into()]);
    }
    Ok(args)
}

pub(crate) fn restart<R: Runtime>(app: &tauri::AppHandle<R>, id: String) {
    let lifecycle = app.state::<Arc<crate::lifecycle::Lifecycle>>();
    let state = app.state::<crate::state::AppState>();
    let result = restart_args(
        &state.state_root,
        state.explicit_root,
        &state.overrides,
        &id,
    )
    .and_then(|args| lifecycle.recovery_ui.schedule_restart(args));
    if let Err(error) = result {
        // journal 仍在；下次正常启动先回滚。当前进程保持关闭，不恢复业务。
        lifecycle.fail(&error);
        tracing::error!(code = %error.code(), "恢复重启未安排");
    }
    crate::application::request_exit(app, &lifecycle);
}
