use dushan_tenon_lib::{contract::*, modules::DECLARATIONS};
use std::{
    collections::BTreeSet,
    env,
    error::Error,
    fs,
    path::{Path, PathBuf},
};
use tenon_desktop::{
    config::{self, Theme},
    native::chrome::{DARK_BACKGROUND, LIGHT_BACKGROUND},
};
use tenon_framework::{
    dict::DictTone,
    error::IpcError,
    module::{BUILTIN, ERROR_CODES},
    param::ParamKind,
};
use ts_rs::{Config, TS, TypeVisitor};
const HEADER: &str = "// 自动生成，勿手改。运行 pnpm generate 更新。\n";
fn import_type<T: TS + 'static>(
    config: &Config,
    imports: &mut BTreeSet<String>,
) -> Result<String, ts_rs::ExportError> {
    // Vec 等容器无独立文件，导出其具名元素及依赖。
    struct Imports<'a>(
        &'a Config,
        &'a mut BTreeSet<String>,
        Result<(), ts_rs::ExportError>,
    );
    impl TypeVisitor for Imports<'_> {
        fn visit<T: TS + 'static + ?Sized>(&mut self) {
            if T::output_path().is_some() {
                let name = T::ident(self.0);
                self.1
                    .insert(format!("import type {{ {name} }} from './{name}';\n"));
                if self.2.is_ok() {
                    self.2 = T::export_all(self.0);
                }
            }
        }
    }
    let mut visitor = Imports(config, imports, Ok(()));
    visitor.visit::<T>();
    T::visit_generics(&mut visitor);
    visitor.2?;
    Ok(T::name(config))
}

macro_rules! command_input {
    ($config:ident, $imports:ident; $event:ty) => {{
        let event_type = import_type::<$event>($config, &mut $imports)?;
        $imports.insert("import type { Channel } from '../ipc/invoke';\n".into());
        (
            format!("onEvent: Channel<{event_type}>"),
            ", { onEvent }".to_owned(),
        )
    }};
    ($config:ident, $imports:ident, $input:ty; $event:ty) => {{
        let (parameter, _) = command_input!($config, $imports, $input);
        let event_type = import_type::<$event>($config, &mut $imports)?;
        tenon_framework::stream::StreamEvent::<$event>::export_all($config)?;
        $imports.insert("import type { StreamChannel } from '../ipc/stream';\n".into());
        (
            format!("{parameter}, channel: StreamChannel<{event_type}>"),
            ", { input, channel }".to_owned(),
        )
    }};
    ($config:ident, $imports:ident) => {
        (String::new(), String::new())
    };
    ($config:ident, $imports:ident, $input:ty) => {{
        let input_type = import_type::<$input>($config, &mut $imports)?;
        (format!("input: {input_type}"), ", { input }".to_owned())
    }};
}

macro_rules! app_commands {
    ($([$admission:ident] $level:ident $(($($permission:literal),+))? $command:ident ($($input:ty)? $(; $event:ty)?) => $output:ty),* $(,)?) => {
        fn write_commands(output: &std::path::Path, config: &Config) -> Result<(), Box<dyn Error>> {
            let mut imports = BTreeSet::new();
            let mut functions = String::new();
            $(
                let name = stringify!($command);
                let return_type = import_type::<$output>(config, &mut imports)?;
                let (parameter, argument) = command_input!(config, imports $(, $input)? $(; $event)?);
                let mut segments = name.split('_');
                let mut function = segments.next().ok_or("empty command name")?.to_owned();
                for segment in segments {
                    function.push_str(&segment[..1].to_ascii_uppercase());
                    function.push_str(&segment[1..]);
                }
                functions.push_str(&format!(
                    "\nexport function {function}({parameter}): Promise<{return_type}> {{\n  return invoke<{return_type}>({}{argument});\n}}\n",
                    serde_json::to_string(name)?
                ));
            )*
            let imports = imports.into_iter().collect::<String>();
            fs::write(output.join("commands.ts"), format!("{HEADER}import {{ invoke }} from '../ipc/invoke';\n{imports}{functions}"))?;
            Ok(())
        }
    };
}

include!("../src/commands/list.rs");

fn write_constants(
    output: &Path,
    file: &str,
    values: &[(&str, serde_json::Value)],
    types: &str,
) -> Result<(), Box<dyn Error>> {
    let mut source = HEADER.to_owned();
    for (name, value) in values {
        source.push_str(&format!(
            "export const {name} = {} as const;\n",
            serde_json::to_string(value)?
        ));
    }
    source.push_str(types);
    fs::write(output.join(file), source)?;
    Ok(())
}

fn preset_catalog() -> Result<Vec<serde_json::Value>, Box<dyn Error>> {
    let workspace = Path::new(env!("CARGO_MANIFEST_DIR")).join("..");
    let temporary = fs::canonicalize(env::temp_dir())?;
    if !temporary.starts_with(fs::canonicalize(workspace.join("Temp"))?) {
        return Err("预设生成的 TEMP/TMP/TMPDIR 必须位于本仓 Temp/ 内".into());
    }
    let staging = tempfile::Builder::new()
        .prefix("assembly-")
        .tempdir_in(&temporary)?;
    let mut files = fs::read_dir(workspace.join("presets"))?
        .map(|entry| entry.map(|entry| entry.path()))
        .collect::<Result<Vec<_>, _>>()?;
    files.retain(|path| {
        path.extension()
            .is_some_and(|extension| extension == "toml")
    });
    files.sort();
    let mut catalog = Vec::new();
    for file in files {
        let name = file
            .file_stem()
            .and_then(|name| name.to_str())
            .ok_or("预设文件名必须为 UTF-8")?;
        let state_root = staging.path().join(name);
        fs::create_dir(&state_root)?;
        fs::copy(&file, state_root.join("config.toml"))?;
        let loaded = config::load(&state_root, [], &[])
            .map_err(|error| format!("预设 {name} 校验失败：{error}"))?;
        let enabled: Vec<_> = DECLARATIONS
            .iter()
            .filter(|declaration| {
                loaded
                    .modules()
                    .get(declaration.id)
                    .is_none_or(|module| module.enabled)
            })
            .map(|declaration| declaration.id)
            .collect();
        catalog.push(serde_json::json!({ "name": name, "enabledModules": enabled }));
    }
    staging.close()?;
    Ok(catalog)
}

fn write_metadata(output: &Path) -> Result<(), Box<dyn Error>> {
    use serde_json::json;
    let permissions: Vec<_> = DECLARATIONS.iter().flat_map(|d| d.permissions).collect();
    let ids: Vec<_> = DECLARATIONS.iter().map(|d| d.id).collect();
    let catalog: Vec<_> = DECLARATIONS.iter().map(|d| json!({
        "id": d.id, "version": d.version, "dependencies": d.dependencies, "core": d.core,
        "requiredCapabilities": d.required_capabilities.iter().map(|c| c.as_str()).collect::<Vec<_>>(),
    })).collect();
    write_constants(
        output,
        "permissions.ts",
        &[
            ("PERMISSION_KEYS", json!(permissions)),
            ("MODULE_IDS", json!(ids)),
        ],
        "export type PermissionKey = (typeof PERMISSION_KEYS)[number];\nexport type ModuleId = (typeof MODULE_IDS)[number];\n",
    )?;
    write_constants(
        output,
        "assembly.ts",
        &[
            ("MODULE_CATALOG", json!(catalog)),
            ("PRESET_CATALOG", json!(preset_catalog()?)),
        ],
        "export type PresetName = (typeof PRESET_CATALOG)[number]['name'];\n",
    )?;
    write_constants(
        output,
        "admission-commands.ts",
        &[
            ("COMMAND_ADMISSION", json!(COMMAND_ADMISSION)),
            ("COMMAND_ACCESS", json!(COMMAND_ACCESS)),
            ("COMMAND_PERMISSIONS", json!(COMMAND_PERMISSIONS)),
        ],
        "",
    )?;
    write_constants(
        output,
        "job-kinds.ts",
        &[(
            "JOB_KINDS",
            json!(
                DECLARATIONS
                    .iter()
                    .flat_map(|d| d.job_kinds)
                    .collect::<Vec<_>>()
            ),
        )],
        "export type JobKind = (typeof JOB_KINDS)[number];\n",
    )?;
    write_constants(
        output,
        "schedule-keys.ts",
        &[(
            "SCHEDULE_KEYS",
            json!(
                DECLARATIONS
                    .iter()
                    .flat_map(|d| d.schedules)
                    .map(|s| s.key)
                    .collect::<Vec<_>>()
            ),
        )],
        "export type ScheduleKey = (typeof SCHEDULE_KEYS)[number];\n",
    )?;
    write_constants(
        output,
        "message-keys.ts",
        &[(
            "MESSAGE_KEYS",
            json!(
                DECLARATIONS
                    .iter()
                    .flat_map(|d| d.message_keys)
                    .collect::<Vec<_>>()
            ),
        )],
        "",
    )?;
    write_constants(
        output,
        "file-purpose-keys.ts",
        &[(
            "FILE_PURPOSE_MESSAGE_KEYS",
            json!(
                DECLARATIONS
                    .iter()
                    .flat_map(|d| d.file_purposes)
                    .map(|p| format!("file.purpose.{}", p.code))
                    .collect::<Vec<_>>()
            ),
        )],
        "",
    )?;
    let mut codes: BTreeSet<_> = ERROR_CODES
        .iter()
        .chain(DECLARATIONS.iter().flat_map(|d| d.error_codes))
        .map(|c| c.as_str())
        .collect();
    use tenon_desktop::{
        config, diagnostics, file_ingress, keyboard, native, network, picked_files, workbench,
    };
    codes.extend(
        [
            IPC_UNEXPECTED,
            OWNER_REQUIRED,
            WINDOW_STATE_INVALID,
            WINDOW_STATE_WRITE_FAILED,
            native::UNAVAILABLE,
            native::COMPENSATION_FAILED,
            native::tray::UNSUPPORTED,
            native::autostart::UNSUPPORTED,
            native::window_controls::EDIT_UNAVAILABLE,
            native::shortcuts::INVALID,
            native::shortcuts::CONFLICT,
            native::shortcuts::UNSUPPORTED,
            native::opener::OPEN_UNAVAILABLE,
            native::updater::UNCONFIGURED,
            native::updater::INVALID_RELEASE,
            native::updater::SIGNATURE_INVALID,
            native::updater::DOWNLOAD_TOO_LARGE,
            native::updater::INSTALL_FAILED,
            native::updater::CHECK_FAILED,
            native::updater::DOWNLOAD_FAILED,
            config::SETTINGS_OVERRIDDEN,
            picked_files::FILE_TOKEN_INVALID,
            file_ingress::INVALID,
            file_ingress::LIMIT,
            file_ingress::UNAVAILABLE,
            file_ingress::RECENT_INVALID,
            file_ingress::IO_FAILED,
            diagnostics::NEEDS_PROBE,
            diagnostics::EXPORT_FAILED,
            network::COMPENSATION_FAILED,
            keyboard::INVALID,
            keyboard::UNSUPPORTED,
            keyboard::READ_FAILED,
            keyboard::WRITE_FAILED,
            keyboard::CONFLICT,
            workbench::INVALID,
            workbench::UNSUPPORTED,
            workbench::READ_FAILED,
            workbench::WRITE_FAILED,
            workbench::CONFLICT,
        ]
        .map(|code| code.as_str()),
    );
    write_constants(
        output,
        "error-codes.ts",
        &[("ERROR_CODES", json!(codes))],
        "export type ErrorCode = (typeof ERROR_CODES)[number];\n",
    )?;
    Ok(())
}

fn write_dictionaries_and_params(output: &Path) -> Result<(), Box<dyn Error>> {
    use serde_json::json;
    let dictionaries: Vec<_> = BUILTIN
        .iter()
        .chain(DECLARATIONS.iter().flat_map(|d| d.dictionaries))
        .collect();
    let keys: Vec<_> = dictionaries
        .iter()
        .flat_map(|d| {
            std::iter::once(format!("dict.{}", d.code)).chain(
                d.items
                    .iter()
                    .map(|i| format!("dict.{}.{}", d.code, i.value)),
            )
        })
        .collect();
    let dictionary_data: serde_json::Map<String, serde_json::Value> = dictionaries
        .iter()
        .map(|d| {
            (
                d.code.to_owned(),
                json!(
                    d.items
                        .iter()
                        .map(|i| json!({"value": i.value, "tone": i.tone.as_str()}))
                        .collect::<Vec<_>>()
                ),
            )
        })
        .collect();
    write_constants(
        output,
        "dict-codes.ts",
        &[
            (
                "DICT_CODES",
                json!(dictionaries.iter().map(|d| d.code).collect::<Vec<_>>()),
            ),
            ("DICT_MESSAGE_KEYS", json!(keys)),
            ("DICTIONARIES", json!(dictionary_data)),
        ],
        "export type DictCode = (typeof DICT_CODES)[number];\n",
    )?;
    let params: Vec<_> = DECLARATIONS.iter().flat_map(|d| d.params).collect();
    let mut seen_groups = BTreeSet::new();
    let mut groups = Vec::new();
    let mut keys = Vec::new();
    for p in &params {
        keys.extend([
            format!("param.{}.name", p.key),
            format!("param.{}.description", p.key),
        ]);
        if let ParamKind::Choice { values } = p.kind {
            keys.extend(values.iter().map(|v| format!("param.{}.choice.{v}", p.key)));
        }
        if seen_groups.insert(p.group) {
            keys.push(format!("param.group.{}", p.group));
            groups.push(json!({"id":p.group,"moduleId":p.key.split_once('.').ok_or("invalid parameter key")?.0}));
        }
    }
    write_constants(
        output,
        "param-keys.ts",
        &[
            (
                "PARAM_KEYS",
                json!(params.iter().map(|p| p.key).collect::<Vec<_>>()),
            ),
            ("PARAM_MESSAGE_KEYS", json!(keys)),
            ("PARAM_GROUPS", json!(groups)),
        ],
        "export type ParamKey = (typeof PARAM_KEYS)[number];\n",
    )?;
    Ok(())
}

fn write_appearance(output: &Path) -> Result<(), Box<dyn Error>> {
    use serde_json::json;
    write_constants(
        output,
        "appearance.ts",
        &[
            ("THEMES", json!([Theme::Light, Theme::Dark, Theme::System])),
            (
                "APPEARANCE_DEFAULTS",
                json!({"theme":Theme::default(),"lightBackground":LIGHT_BACKGROUND,"darkBackground":DARK_BACKGROUND}),
            ),
        ],
        "",
    )?;
    use tenon_desktop::workbench;
    write_constants(
        output,
        "workbench.ts",
        &[
            ("WORKBENCH_DEFAULTS", json!(WorkbenchSnapshot::default())),
            ("MAX_OBJECTS", json!(workbench::MAX_OBJECTS)),
            (
                "CONSOLE_LAYOUT_LIMITS",
                json!({"min":workbench::PRIMARY_MIN,"max":workbench::PRIMARY_MAX,"collapsed":workbench::PRIMARY_COLLAPSED}),
            ),
            (
                "AUXILIARY_LAYOUT_LIMITS",
                json!({"min":workbench::AUXILIARY_MIN,"max":workbench::AUXILIARY_MAX}),
            ),
        ],
        "",
    )?;
    Ok(())
}

fn main() -> Result<(), Box<dyn Error>> {
    let mut args = env::args_os().skip(1);
    let output = PathBuf::from(args.next().ok_or("用法: ipc_contract <输出目录>")?);
    if args.next().is_some() {
        return Err("只接受一个输出目录参数".into());
    }
    fs::create_dir_all(&output)?;
    // 输出目录由生成器独占，移除不再被 Rust 合同引用的旧文件。
    for entry in fs::read_dir(&output)? {
        let path = entry?.path();
        if path.extension().is_some_and(|extension| extension == "ts") {
            fs::remove_file(path)?;
        }
    }
    let config = Config::default().with_out_dir(&output);
    write_commands(&output, &config)?;
    DictTone::export_all(&config)?;
    tenon_framework::db::PageRequest::export_all(&config)?;
    tenon_framework::exchange::ImportMode::export_all(&config)?;
    tenon_framework::exchange::ImportReport::export_all(&config)?;
    fs::write(
        output.join("IpcError.ts"),
        format!("{HEADER}export {}\n", IpcError::decl(&config)),
    )?;
    write_metadata(&output)?;
    write_dictionaries_and_params(&output)?;
    write_appearance(&output)?;
    Ok(())
}
