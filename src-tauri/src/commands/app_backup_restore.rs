use super::{AppState, RestoreAccepted, RestoreCommitInput};
use tauri::Manager;
use tenon_framework::{error::IpcError, ipc, stream::StreamOwner};

#[tauri::command]
pub async fn app_backup_restore<R: tauri::Runtime>(
    window: tauri::WebviewWindow<R>,
    state: tauri::State<'_, AppState>,
    input: RestoreCommitInput,
) -> Result<RestoreAccepted, IpcError> {
    let app = window.app_handle().clone();
    let result = ipc::execute(
        state.inner(),
        stringify!(app_backup_restore),
        |state| async move {
            crate::data::commit_restore(
                window.app_handle().clone(),
                StreamOwner {
                    actor: state.execution.actor,
                    scope: window.label().into(),
                },
                input.prepared_id,
            )
            .await
        },
    )
    .await;
    // IPC 已记录结果并释放维护许可，再交给唯一 ExitController 关闭资源。
    if let Ok(accepted) = &result {
        crate::restore::restart(&app, accepted.operation_id.clone());
    }
    result
}
