use super::{AppState, DataStatus};
use tenon_framework::{actor::Actor, error::IpcError, ipc};

#[tauri::command]
pub async fn app_data_status(state: tauri::State<'_, AppState>) -> Result<DataStatus, IpcError> {
    ipc::execute(
        state.inner(),
        stringify!(app_data_status),
        |state| async move {
            let config = crate::ports::read(&state.config)?;
            state.data.status(
                state.execution.actor == Actor::User(state.account.owner_id()?),
                &config,
            )
        },
    )
    .await
}
