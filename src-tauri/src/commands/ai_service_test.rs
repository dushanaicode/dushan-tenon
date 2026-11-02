use super::{AiConnectionTest, AppState};
use tenon_framework::{error::IpcError, ipc};

#[tauri::command]
pub async fn ai_service_test(
    state: tauri::State<'_, AppState>,
) -> Result<AiConnectionTest, IpcError> {
    ipc::execute(
        state.inner(),
        stringify!(ai_service_test),
        |state| async move { state.ai.test_connection(&state.execution).await },
    )
    .await
}
