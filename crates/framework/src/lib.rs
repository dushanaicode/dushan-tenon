//! 可脱离桌面宿主使用的通用内核：基础值类型、错误与服务原语。
//! 模块按依赖顺序组合，产品身份和应用配置由调用方提供。
//! 分层与公开接口约束见仓库的 [架构文档](../../../docs/architecture.md)。

pub mod actor;
pub mod bootstrap;
pub mod cache;
pub mod db;
pub mod dict;
pub mod error;
pub mod exchange;
pub mod file;
pub mod i18n;
pub mod id;
pub mod instance;
pub mod logging;
pub mod maintenance;
pub mod migrations;
pub mod network;
pub mod param;
pub mod secret;
pub mod time;

pub mod job;
pub mod stream;
