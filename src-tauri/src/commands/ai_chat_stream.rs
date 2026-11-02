use super::{AiChatInput, AiStreamData, AppState};
use crate::stream::ChannelSink;
use tenon_framework::{error::IpcError, ipc, stream::StreamEvent};

#[tauri::command]
pub async fn ai_chat_stream<R: tauri::Runtime>(
    window: tauri::WebviewWindow<R>,
    state: tauri::State<'_, AppState>,
    input: AiChatInput,
    channel: tauri::ipc::Channel<StreamEvent<AiStreamData>>,
) -> Result<(), IpcError> {
    ipc::execute(
        state.inner(),
        stringify!(ai_chat_stream),
        |state| async move {
            state
                .ai
                .chat(
                    &state.execution,
                    window.label(),
                    input,
                    &state.streams,
                    ChannelSink(channel),
                )
                .await
        },
    )
    .await
}
