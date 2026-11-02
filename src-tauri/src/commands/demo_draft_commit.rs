use super::{AppState, DemoDraftLease, DemoSample};
use tenon_framework::{error::IpcError, ipc};

#[tauri::command]
pub async fn demo_draft_commit(
    state: tauri::State<'_, AppState>,
    input: DemoDraftLease,
) -> Result<DemoSample, IpcError> {
    ipc::execute(
        state.inner(),
        stringify!(demo_draft_commit),
        |state| async move { state.demo.draft_commit(&state.execution, input).await },
    )
    .await
}
