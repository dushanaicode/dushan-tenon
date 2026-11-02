//! Tauri 适配：命令集合仅由 list.rs 声明，所有用例经 framework IPC。

pub use crate::state::AppState;
pub use dushan_tenon_lib::contract::*;

macro_rules! app_commands {
    ($([$admission:ident] $level:ident $(($($permission:literal),+))? $command:ident ($($input:ty)? $(; $event:ty)?) => $output:ty),* $(,)?) => {
        $(
            #[expect(clippy::unreachable, reason = "Tauri 2.12 命令宏在 const if false 中用 unreachable! 检查异步返回类型，该分支不执行")]
            pub mod $command;
        )*
        pub(crate) fn handler<R: tauri::Runtime>() -> impl Fn(tauri::ipc::Invoke<R>) -> bool + Send + Sync + 'static {
            tauri::generate_handler![$($command::$command),*]
        }
    };
}
include!("list.rs");
