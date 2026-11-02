use tenon_framework::{error::IpcError, ipc};

use super::{AppState, ParamEntry, SettingResetInput};

#[tauri::command]
pub async fn app_setting_reset(
    state: tauri::State<'_, AppState>,
    input: SettingResetInput,
) -> Result<ParamEntry, IpcError> {
    ipc::execute(
        state.inner(),
        stringify!(app_setting_reset),
        |state| async move {
            state
                .setting_for_write(&state.execution, &input.key, input.row_version)
                .await?;
            state.params.reset(&input.key, input.row_version).await?;
            state.setting_entry(&input.key).await
        },
    )
    .await
}
