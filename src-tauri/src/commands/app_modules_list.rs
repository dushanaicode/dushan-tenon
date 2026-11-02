use tenon_framework::{error::IpcError, ipc};

use super::{AppModules, AppState};

#[tauri::command]
pub async fn app_modules_list(state: tauri::State<'_, AppState>) -> Result<AppModules, IpcError> {
    ipc::execute(
        state.inner(),
        stringify!(app_modules_list),
        |state| async move {
            Ok(AppModules {
                modules: state.modules.list(&state.migrations.applied),
            })
        },
    )
    .await
}
