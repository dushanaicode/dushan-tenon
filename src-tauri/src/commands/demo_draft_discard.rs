use super::{AppState, DemoDraftLease};
use tenon_framework::{error::IpcError, ipc};

#[tauri::command]
pub async fn demo_draft_discard(
    state: tauri::State<'_, AppState>,
    input: DemoDraftLease,
) -> Result<(), IpcError> {
    ipc::execute(
        state.inner(),
        stringify!(demo_draft_discard),
        |state| async move { state.demo.draft_discard(&state.execution, input).await },
    )
    .await
}
