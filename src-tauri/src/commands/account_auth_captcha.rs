use super::{AppState, CaptchaChallenge};
use tenon_framework::{error::IpcError, ipc};

#[tauri::command]
pub async fn account_auth_captcha(
    state: tauri::State<'_, AppState>,
) -> Result<CaptchaChallenge, IpcError> {
    ipc::execute_public(
        state.inner(),
        stringify!(account_auth_captcha),
        |state| async move { state.account.captcha().await },
    )
    .await
}
