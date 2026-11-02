use super::{AppState, DemoOverview};
use tenon_framework::{error::IpcError, ipc};

#[tauri::command]
pub async fn demo_overview_get(
    state: tauri::State<'_, AppState>,
) -> Result<DemoOverview, IpcError> {
    ipc::execute(
        state.inner(),
        stringify!(demo_overview_get),
        |state| async move { state.demo.overview_get(&state.execution).await },
    )
    .await
}
