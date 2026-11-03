use super::{AppState, OperationCancelInput};
use tenon_framework::{error::IpcError, ipc};

#[tauri::command]
pub async fn app_operation_cancel(
    state: tauri::State<'_, AppState>,
    input: OperationCancelInput,
) -> Result<(), IpcError> {
    ipc::execute_control(state.inner(), stringify!(app_operation_cancel), || {
        state.data.cancel(&input.operation_id)?;
        state.native.updater.cancel(&input.operation_id)
    })
    .await
}
