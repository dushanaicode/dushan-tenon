use super::{AppState, UpdateInstallInput};
use crate::lifecycle::Lifecycle;
use std::sync::Arc;
use tauri::Manager;
use tenon_desktop::native::{
    updater::{INSTALL_FAILED, safe_error},
    window_controls::require_main,
};
use tenon_framework::{error::IpcError, ipc, stream::StreamOwner};

#[tauri::command]
pub async fn app_update_install<R: tauri::Runtime>(
    window: tauri::WebviewWindow<R>,
    state: tauri::State<'_, AppState>,
    input: UpdateInstallInput,
) -> Result<(), IpcError> {
    let label = window.label().to_owned();
    let (plan, trace) = ipc::execute(
        state.inner(),
        stringify!(app_update_install),
        |state| async move {
            require_main(&label)?;
            state.require_owner(state.execution.actor)?;
            let plan = state.native.updater.prepare_install(
                StreamOwner {
                    actor: state.execution.actor,
                    scope: label,
                },
                input,
            )?;
            Ok((plan, state.execution.trace_id.clone()))
        },
    )
    .await?;
    // IPC 已写运行日志并释放维护许可，才永久关闭准入。
    state.gate.close_admission();
    let runtime = tokio::runtime::Handle::current();
    let app = window.app_handle().clone();
    let lifecycle = app.state::<Arc<Lifecycle>>().inner().clone();
    let before_exit = Arc::new(move || {
        runtime.block_on(lifecycle.exit.request_exit(lifecycle.shutdown()));
        app.cleanup_before_exit();
    });
    let native = state.native.clone();
    let worker_trace = trace.clone();
    // 原生资源关闭可能需要事件线程；安装与等待只在 blocking worker 上执行。
    let result = tokio::task::spawn_blocking(move || {
        native.updater.install(plan, before_exit, &worker_trace)
    })
    .await
    .unwrap_or_else(|_| Err(safe_error(INSTALL_FAILED, &trace)));
    if result.is_err()
        && window
            .unminimize()
            .and_then(|()| window.set_decorations(true))
            .and_then(|()| window.show())
            .is_err()
    {
        eprintln!("app.update.install_failed: window_unavailable; trace_id={trace}");
    }
    result
}
