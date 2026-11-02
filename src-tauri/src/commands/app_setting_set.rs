use tenon_framework::{error::IpcError, ipc};

use super::{AppState, ParamEntry, SettingSetInput};

#[tauri::command]
pub async fn app_setting_set(
    state: tauri::State<'_, AppState>,
    input: SettingSetInput,
) -> Result<ParamEntry, IpcError> {
    ipc::execute(
        state.inner(),
        stringify!(app_setting_set),
        |state| async move {
            state
                .setting_for_write(&state.execution, &input.key, input.row_version)
                .await?;
            state
                .params
                .set(
                    &state.execution,
                    &input.key,
                    &input.value,
                    input.row_version,
                )
                .await?;
            state.setting_entry(&input.key).await
        },
    )
    .await
}
