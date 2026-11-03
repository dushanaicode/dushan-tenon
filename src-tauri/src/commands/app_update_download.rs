use std::sync::Arc;

use super::{AppState, OperationProgress, UpdateDownloadInput, UpdateState};
use tenon_framework::{
    error::IpcError,
    ipc,
    stream::{StreamEvent, StreamOwner},
};

#[tauri::command]
pub async fn app_update_download<R: tauri::Runtime>(
    window: tauri::WebviewWindow<R>,
    state: tauri::State<'_, AppState>,
    input: UpdateDownloadInput,
    channel: tauri::ipc::Channel<StreamEvent<OperationProgress>>,
) -> Result<UpdateState, IpcError> {
    ipc::execute(
        state.inner(),
        stringify!(app_update_download),
        |state| async move {
            tenon_desktop::native::window_controls::require_main(window.label())?;
            state.require_owner(state.execution.actor)?;
            let owner = StreamOwner {
                actor: state.execution.actor,
                scope: window.label().into(),
            };
            let stream = Arc::new(
                state
                    .streams
                    .open(owner.clone(), crate::stream::ChannelSink(channel))?,
            );
            let result = state
                .native
                .updater
                .download(owner, input, stream.clone(), &state.execution.trace_id)
                .await;
            match &result {
                Ok(_) => {
                    let _ = stream.succeeded(None);
                }
                Err(error) => {
                    let _ = stream.failed(error.code().as_str().into(), Default::default());
                }
            }
            result
        },
    )
    .await
}
