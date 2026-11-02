use super::{AppState, StreamCancel};
use tenon_framework::{error::IpcError, ipc, stream::StreamOwner};

#[tauri::command]
pub async fn app_stream_cancel<R: tauri::Runtime>(
    window: tauri::WebviewWindow<R>,
    state: tauri::State<'_, AppState>,
    input: StreamCancel,
) -> Result<(), IpcError> {
    ipc::execute(
        state.inner(),
        stringify!(app_stream_cancel),
        |state| async move {
            state.streams.cancel(
                &StreamOwner {
                    actor: state.execution.actor,
                    scope: window.label().into(),
                },
                input.stream_id,
            )
        },
    )
    .await
}
