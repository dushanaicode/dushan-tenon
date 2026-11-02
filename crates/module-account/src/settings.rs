use serde::{Deserialize, Serialize};
use tenon_framework::error::AppError;
use ts_rs::TS;

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq, Eq, TS)]
#[serde(rename_all = "lowercase")]
pub enum AuthMode {
    #[default]
    None,
    Login,
}

/// 宿主已校验的实时认证策略；单位与字段名一致。
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct AuthPolicy {
    pub mode: AuthMode,
    pub session_max_hours: i64,
    pub captcha_after_failures: i64,
    pub lock_after_failures: i64,
    pub lock_minutes: i64,
}

/// 认证配置端口，由宿主实现配置来源与持久化事务。
pub trait AuthSettings: Send + Sync {
    /// 读取当前策略；包括锁中毒在内的读取失败必须返回错误。
    fn read(&self) -> Result<AuthPolicy, AppError>;

    /// 在同一次配置事务中校验来源、写盘并提交内存；失败不得提交新模式。
    /// 数据库提交失败时 account 会用旧模式补偿，补偿失败也必须返回错误。
    fn set_mode(&self, mode: AuthMode) -> Result<(), AppError>;
}
