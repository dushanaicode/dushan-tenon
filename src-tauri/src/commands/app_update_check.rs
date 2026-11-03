use super::{AppState, UpdateState};
use tenon_framework::{error::IpcError, ipc, stream::StreamOwner};

#[tauri::command]
pub async fn app_update_check<R: tauri::Runtime>(
    window: tauri::WebviewWindow<R>,
    state: tauri::State<'_, AppState>,
) -> Result<UpdateState, IpcError> {
    ipc::execute(
        state.inner(),
        stringify!(app_update_check),
        |state| async move {
            crate::native::updater::check(
                &state,
                StreamOwner {
                    actor: state.execution.actor,
                    scope: window.label().into(),
                },
                &state.execution.trace_id,
            )
            .await
        },
    )
    .await
}
