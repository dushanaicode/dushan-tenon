//! Tauri 命令入口。具体子系统入口按宿主批次接入；未登记命令由 Tauri 拒绝。

pub(crate) fn handler<R: tauri::Runtime>()
-> impl Fn(tauri::ipc::Invoke<R>) -> bool + Send + Sync + 'static {
    tauri::generate_handler![]
}
