use super::{AppState, ArchiveOperationInput, FileArtifact, OperationProgress};
use std::{sync::Arc, time::Duration};
use tauri::Manager;
use tenon_framework::{
    error::IpcError,
    ipc,
    stream::{StreamEvent, StreamOwner},
};

#[tauri::command]
pub async fn app_backup_export<R: tauri::Runtime>(
    window: tauri::WebviewWindow<R>,
    state: tauri::State<'_, AppState>,
    input: ArchiveOperationInput,
    channel: tauri::ipc::Channel<StreamEvent<OperationProgress>>,
) -> Result<FileArtifact, IpcError> {
    let (entered, started) = tokio::sync::oneshot::channel();
    let operation = ipc::execute(
        state.inner(),
        stringify!(app_backup_export),
        |state| async move {
            let _ = entered.send(());
            let owner = StreamOwner {
                actor: state.execution.actor,
                scope: window.label().into(),
            };
            crate::data::require_owner(&state, &owner)?;
            let stream = Arc::new(
                state
                    .streams
                    .open(owner.clone(), crate::stream::ChannelSink(channel))?,
            );
            let result = crate::data::export(
                window.app_handle().clone(),
                owner,
                input.file_token,
                crate::data::observer(stream.clone()),
            )
            .await;
            crate::data::finish(&stream, &result);
            result
        },
    );
    tokio::pin!(operation);
    // 只限制备份进入维护独占的排空时间；进入后按操作自己的取消合同运行。
    tokio::select! {
        biased;
        result = &mut operation => result,
        _ = started => operation.await,
        _ = tokio::time::sleep(Duration::from_secs(5)) => Err(IpcError {
            code: tenon_framework::maintenance::OPERATION_BUSY.as_str().into(),
            params: Default::default(), trace_id: tenon_framework::id::Id::new().to_string(),
        }),
    }
}
