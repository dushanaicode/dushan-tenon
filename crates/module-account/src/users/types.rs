use crate::{AuthMode, CaptchaAnswer};
use serde::{Deserialize, Serialize};
use tenon_framework::id::Id;
use ts_rs::TS;

#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct CurrentUser {
    pub id: Id,
    pub display_name: String,
    pub mode: AuthMode,
}

#[derive(Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UserProfileUpdate {
    pub display_name: String,
}

#[derive(Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UserPasswordChange {
    pub current_password: String,
    pub new_password: String,
    #[ts(optional)]
    pub captcha: Option<CaptchaAnswer>,
}
