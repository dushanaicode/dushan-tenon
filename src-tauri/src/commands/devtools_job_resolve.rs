use super::{AppState, JobResolve};
use tenon_framework::{error::IpcError, ipc};

#[tauri::command]
pub async fn devtools_job_resolve(
    state: tauri::State<'_, AppState>,
    input: JobResolve,
) -> Result<(), IpcError> {
    ipc::execute(
        state.inner(),
        stringify!(devtools_job_resolve),
        |state| async move { tenon_module_devtools::resolve(&state.jobs, input).await },
    )
    .await
}
