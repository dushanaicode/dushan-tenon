use super::{AiCancelInput, AppState};
use tenon_framework::{error::IpcError, ipc, stream::StreamOwner};

#[tauri::command]
pub async fn ai_chat_cancel<R: tauri::Runtime>(
    window: tauri::WebviewWindow<R>,
    state: tauri::State<'_, AppState>,
    input: AiCancelInput,
) -> Result<(), IpcError> {
    ipc::execute(
        state.inner(),
        stringify!(ai_chat_cancel),
        |state| async move {
            state.ai.cancel(
                &StreamOwner {
                    actor: state.execution.actor,
                    scope: window.label().into(),
                },
                input,
            )
        },
    )
    .await
}
