//! 仅供维护者手动运行；会读写独立测试注册名，禁止接入自动测试。
#[cfg(windows)]
use std::{
    error::Error,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

#[cfg(windows)]
use tenon_desktop::native::autostart::{AutostartAdapter, Registration};
#[cfg(windows)]
#[path = "../src/native/autostart_registry.rs"]
mod autostart_registry;
#[cfg(windows)]
use autostart_registry::SystemAutostart;

#[cfg(windows)]
fn state_root(value: &str) -> Result<PathBuf, Box<dyn Error>> {
    let repository = Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .ok_or("repository parent unavailable")?;
    let temporary = repository.join("Temp").canonicalize()?;
    let root = Path::new(value).canonicalize()?;
    if root == temporary || !root.starts_with(&temporary) || !root.is_dir() {
        return Err("状态目录必须是当前仓库 Temp 下已有的具体子目录".into());
    }
    Ok(root)
}

#[cfg(windows)]
fn main() -> Result<(), Box<dyn Error>> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    // 自动登录启动只写无业务证据，不再次访问自启注册项。
    if let [flag, path] = args.as_slice()
        && flag == "--state-root"
    {
        let root = state_root(path)?;
        std::fs::write(
            root.join("autostart-started.txt"),
            format!(
                "{}\n",
                SystemTime::now().duration_since(UNIX_EPOCH)?.as_secs()
            ),
        )?;
        return Ok(());
    }
    let [action, name, flag, path] = args.as_slice() else {
        return Err("用法: autostart_fixture <status|enable|disable> <TenonTest-注册名> --state-root <仓库Temp子目录>".into());
    };
    if !matches!(action.as_str(), "status" | "enable" | "disable")
        || !name.starts_with("TenonTest-")
        || name.len() <= "TenonTest-".len()
        || name.len() > 80
        || !name
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
        || flag != "--state-root"
    {
        return Err("无效动作、测试注册名或参数".into());
    }
    let root = state_root(path)?;
    let adapter = SystemAutostart::new(
        name,
        &std::env::current_exe()?,
        &[
            "--state-root".into(),
            root.to_str().ok_or("状态目录必须是 UTF-8")?.into(),
        ],
    )?;
    match action.as_str() {
        "enable" => adapter.enable()?,
        "disable" => adapter.disable()?,
        "status" => {}
        _ => return Err("invalid action".into()),
    }
    match adapter.registered()? {
        Registration::Registered(command) => println!("registered={command}"),
        Registration::NotRegistered => println!("notRegistered"),
    }
    println!("approval={:?}", adapter.approval()?);
    Ok(())
}

#[cfg(not(windows))]
fn main() -> Result<(), &'static str> {
    Err("该自启验收夹具仅支持 Windows")
}
