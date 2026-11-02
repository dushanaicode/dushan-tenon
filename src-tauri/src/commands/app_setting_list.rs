use std::collections::BTreeSet;

use tenon_framework::{
    error::{AppError, DATA_NOT_FOUND, IpcError},
    ipc,
};

use super::{AppState, ParamEntry, SettingListInput};

#[tauri::command]
pub async fn app_setting_list(
    state: tauri::State<'_, AppState>,
    input: SettingListInput,
) -> Result<Vec<ParamEntry>, IpcError> {
    ipc::execute(
        state.inner(),
        stringify!(app_setting_list),
        |state| async move {
            if input.include_disabled
                && !crate::ports::read(&state.config)?
                    .settings()
                    .developer_mode
                    .value
            {
                return Err(AppError::new(DATA_NOT_FOUND));
            }
            let modules = state.modules.list(&[]);
            let mut readable = BTreeSet::new();
            for declaration in state.params.declarations() {
                let module_id = declaration
                    .key
                    .split_once('.')
                    .ok_or_else(|| AppError::new(tenon_framework::error::INTERNAL_UNEXPECTED))?
                    .0;
                if !input.include_disabled
                    && !modules
                        .iter()
                        .any(|module| module.id == module_id && module.enabled)
                {
                    continue;
                }
                if let Some(permission) = declaration.read_permission
                    && !state
                        .identity
                        .permission_lookup
                        .has_permission(state.execution.actor, permission)
                        .await?
                {
                    continue;
                }
                readable.insert(declaration.key);
            }
            Ok(state
                .params
                .entries()
                .await?
                .into_iter()
                .filter(|entry| readable.contains(entry.key.as_str()))
                .collect())
        },
    )
    .await
}
