use super::{AppState, DemoListInput, DemoSample, Page};
use tenon_framework::{error::IpcError, ipc};

#[tauri::command]
pub async fn demo_sample_list(
    state: tauri::State<'_, AppState>,
    input: DemoListInput,
) -> Result<Page<DemoSample>, IpcError> {
    ipc::execute(
        state.inner(),
        stringify!(demo_sample_list),
        |state| async move { state.demo.sample_list(&state.execution, input).await },
    )
    .await
}
