use super::{AppState, ScheduleSnapshot};
use tenon_framework::{error::IpcError, ipc};

#[tauri::command]
pub async fn devtools_schedule_list(
    state: tauri::State<'_, AppState>,
) -> Result<Vec<ScheduleSnapshot>, IpcError> {
    ipc::execute(
        state.inner(),
        stringify!(devtools_schedule_list),
        |state| async move { tenon_module_devtools::schedule::list(&state.jobs).await },
    )
    .await
}
