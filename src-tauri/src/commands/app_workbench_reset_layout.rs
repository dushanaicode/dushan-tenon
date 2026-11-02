use super::*;
use tenon_framework::{
    error::{AppError, IpcError},
    ipc,
};

#[tauri::command]
pub async fn app_workbench_reset_layout(
    state: tauri::State<'_, AppState>,
    input: WorkbenchResetLayout,
) -> Result<WorkbenchSnapshot, IpcError> {
    ipc::execute(
        state.inner(),
        stringify!(app_workbench_reset_layout),
        |state| async move {
            let tenon_framework::actor::Actor::User(subject) = state.execution.actor else {
                return Err(AppError::new(tenon_framework::error::PERMISSION_DENIED));
            };
            state
                .account
                .with_active_user(subject, || state.workbench.reset_layout(subject, input))
                .await?
                .ok_or_else(|| AppError::new(tenon_framework::error::PERMISSION_DENIED))
        },
    )
    .await
}
