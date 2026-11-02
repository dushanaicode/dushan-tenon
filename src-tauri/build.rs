use std::{env, error::Error, fs, path::Path};

macro_rules! app_commands {
    ($([$admission:ident] $level:ident $(($($permission:literal),+))? $command:ident ($($input:ty)? $(; $event:ty)?) => $output:ty),* $(,)?) => {
        const COMMAND_NAMES: &[&str] = &[$(stringify!($command)),*];
    };
}
include!("src/commands/list.rs");

fn write_changed(path: &Path, content: &[u8]) -> Result<(), std::io::Error> {
    match fs::read(path) {
        Ok(previous) if previous == content => return Ok(()),
        Ok(_) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(error),
    }
    fs::write(path, content)
}

fn main() -> Result<(), Box<dyn Error>> {
    println!("cargo:rerun-if-changed=src/commands/list.rs");
    let permissions: Vec<_> = COMMAND_NAMES
        .iter()
        .flat_map(|command| {
            ["allow", "deny"].map(|rule| {
                serde_json::json!({
                    "identifier": format!("{rule}-{}", command.replace('_', "-")),
                    "commands": {rule: [command]},
                })
            })
        })
        .collect();
    // AppManifest::commands 固定写源码目录；用官方路径接口接收隔离输出。
    let manifest = Path::new(&env::var("OUT_DIR")?).join("command-permissions.json");
    write_changed(
        &manifest,
        &serde_json::to_vec_pretty(&serde_json::json!({"permission": permissions}))?,
    )?;
    let capability = serde_json::json!({
        "$schema": "../gen/schemas/desktop-schema.json",
        "identifier": "main",
        "description": "主窗口的应用命令，由 commands/list.rs 生成。",
        "windows": ["main"],
        "permissions": COMMAND_NAMES.iter().map(|command| format!("allow-{}", command.replace('_', "-"))).collect::<Vec<_>>(),
    });
    let content = serde_json::to_string_pretty(&capability)?.replace(
        "\"windows\": [\n    \"main\"\n  ]",
        "\"windows\": [\"main\"]",
    ) + "\n";
    write_changed(Path::new("capabilities/main.json"), content.as_bytes())?;
    let pattern = Box::leak(
        manifest
            .to_string_lossy()
            .replace('\\', "/")
            .into_boxed_str(),
    );
    tauri_build::try_build(
        tauri_build::Attributes::new()
            .app_manifest(tauri_build::AppManifest::new().permissions_path_pattern(pattern)),
    )?;
    Ok(())
}
