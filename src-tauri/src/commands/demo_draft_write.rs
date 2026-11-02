use super::{AppState, DemoDraftSaved, DemoDraftWrite};
use tenon_framework::{error::IpcError, ipc};

#[tauri::command]
pub async fn demo_draft_write(
    state: tauri::State<'_, AppState>,
    input: DemoDraftWrite,
) -> Result<DemoDraftSaved, IpcError> {
    ipc::execute(
        state.inner(),
        stringify!(demo_draft_write),
        |state| async move { state.demo.draft_write(&state.execution, input).await },
    )
    .await
}
