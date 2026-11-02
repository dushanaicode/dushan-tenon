use super::{AppState, DemoDraftOpen, DemoSampleDraft};
use tenon_framework::{error::IpcError, ipc};

#[tauri::command]
pub async fn demo_draft_open(
    state: tauri::State<'_, AppState>,
    input: DemoDraftOpen,
) -> Result<DemoSampleDraft, IpcError> {
    ipc::execute(
        state.inner(),
        stringify!(demo_draft_open),
        |state| async move { state.demo.draft_open(&state.execution, input).await },
    )
    .await
}
