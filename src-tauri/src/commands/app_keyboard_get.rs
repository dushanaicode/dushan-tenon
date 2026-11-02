use super::*;
use tenon_framework::{
    error::{AppError, IpcError},
    ipc,
};

#[tauri::command]
pub async fn app_keyboard_get(
    state: tauri::State<'_, AppState>,
) -> Result<KeyboardSettings, IpcError> {
    ipc::execute(
        state.inner(),
        stringify!(app_keyboard_get),
        |state| async move {
            let actor = state.execution.actor;
            let tenon_framework::actor::Actor::User(subject) = actor else {
                return Err(AppError::new(tenon_framework::error::PERMISSION_DENIED));
            };
            let can_edit = subject == state.account.owner_id()?;

            state
                .account
                .with_active_user(subject, || {
                    Ok(KeyboardSettings {
                        can_edit,
                        snapshot: state.keyboard.read(subject)?,
                    })
                })
                .await?
                .ok_or_else(|| AppError::new(tenon_framework::error::PERMISSION_DENIED))
        },
    )
    .await
}
