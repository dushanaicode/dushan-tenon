//! 桌面配置与宿主无关服务；不依赖 Tauri 或业务模块，由宿主装配。

pub mod config;
pub mod data;
pub mod database;
pub mod diagnostics;
pub mod file_ingress;
pub mod i18n;
pub mod identity;
pub mod keyboard;
pub mod native;
pub mod network;
pub mod picked_files;
pub mod restore;
pub mod startup_recovery;
pub mod state_root;
pub mod workbench;
