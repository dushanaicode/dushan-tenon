use super::{AppState, ArchiveOperationInput, OperationProgress, RestorePlan};
use std::sync::Arc;
use tauri::Manager;
use tenon_framework::{
    error::IpcError,
    ipc,
    stream::{StreamEvent, StreamOwner},
};

#[tauri::command]
pub async fn app_backup_prepare_restore<R: tauri::Runtime>(
    window: tauri::WebviewWindow<R>,
    state: tauri::State<'_, AppState>,
    input: ArchiveOperationInput,
    channel: tauri::ipc::Channel<StreamEvent<OperationProgress>>,
) -> Result<RestorePlan, IpcError> {
    ipc::execute(
        state.inner(),
        stringify!(app_backup_prepare_restore),
        |state| async move {
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
            let result = crate::data::prepare_restore(
                window.app_handle().clone(),
                owner,
                input.file_token,
                crate::data::observer(stream.clone()),
            )
            .await;
            crate::data::finish(&stream, &result);
            result
        },
    )
    .await
}
