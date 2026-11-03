use std::sync::Arc;

use tenon_framework::error::AppError;

use tenon_desktop::native::{
    UNAVAILABLE,
    autostart::{AutostartAdapter, Registration, StartupApproval},
};

const RUN: &str = r"Software\Microsoft\Windows\CurrentVersion\Run";
const APPROVAL: &str = r"Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run";

#[derive(Clone)]
enum RegistryValue {
    String(Vec<u8>),
    Binary(Vec<u8>),
    Other,
}

/// 仅 HKCU 后端；不开放 hive、递归删除或通用注册表 IPC。
trait Registry: Send + Sync {
    fn read(&self, path: &str, name: &str) -> Result<Option<RegistryValue>, AppError>;
    fn write_string(&self, path: &str, name: &str, value: &str) -> Result<(), AppError>;
    fn delete(&self, path: &str, name: &str) -> Result<(), AppError>;
}

pub struct SystemAutostart {
    registry: Arc<dyn Registry>,
    name: String,
    command: String,
}

impl SystemAutostart {
    /// 构造不访问注册表；参数由生产入口或受限手动夹具提供。
    #[cfg(windows)]
    pub fn new(
        name: &str,
        executable: &std::path::Path,
        args: &[String],
    ) -> Result<Self, AppError> {
        if !executable.is_absolute() {
            return Err(AppError::new(UNAVAILABLE));
        }
        Self::with_registry(
            Arc::new(CurrentUserRegistry),
            name,
            executable
                .to_str()
                .ok_or_else(|| AppError::new(UNAVAILABLE))?,
            args,
        )
    }

    fn with_registry(
        registry: Arc<dyn Registry>,
        name: &str,
        executable: &str,
        args: &[String],
    ) -> Result<Self, AppError> {
        if name.is_empty() || name.contains('\0') {
            return Err(AppError::new(UNAVAILABLE));
        }
        Ok(Self {
            registry,
            name: name.into(),
            command: command_line(executable, args)?,
        })
    }

    pub fn enable(&self) -> Result<(), AppError> {
        self.registry.write_string(RUN, &self.name, &self.command)
    }

    pub fn disable(&self) -> Result<(), AppError> {
        self.registry.delete(RUN, &self.name)
    }
}

impl AutostartAdapter for SystemAutostart {
    fn registered(&self) -> Result<Registration, AppError> {
        parse_registration(self.registry.read(RUN, &self.name)?)
    }

    fn approval(&self) -> Result<StartupApproval, AppError> {
        Ok(parse_approval(
            self.registry.read(APPROVAL, &self.name)?.as_ref(),
        ))
    }

    fn set_registered(&self, enabled: bool) -> Result<Registration, AppError> {
        if enabled {
            self.enable()?;
            Ok(Registration::Registered(self.command.clone()))
        } else {
            self.disable()?;
            Ok(Registration::NotRegistered)
        }
    }

    fn restore(&self, snapshot: &Registration) -> Result<(), AppError> {
        match snapshot {
            Registration::Registered(command) => {
                self.registry.write_string(RUN, &self.name, command)
            }
            Registration::NotRegistered => self.disable(),
        }
    }
}

fn parse_registration(value: Option<RegistryValue>) -> Result<Registration, AppError> {
    let Some(value) = value else {
        return Ok(Registration::NotRegistered);
    };
    let RegistryValue::String(bytes) = value else {
        return Err(AppError::new(UNAVAILABLE));
    };
    let (pairs, remainder) = bytes.as_chunks::<2>();
    if !remainder.is_empty() {
        return Err(AppError::new(UNAVAILABLE));
    }
    let mut wide: Vec<u16> = pairs.iter().map(|pair| u16::from_le_bytes(*pair)).collect();
    while wide.last() == Some(&0) {
        wide.pop();
    }
    if wide.contains(&0) {
        return Err(AppError::new(UNAVAILABLE));
    }
    String::from_utf16(&wide)
        .map(Registration::Registered)
        .map_err(|_| AppError::new(UNAVAILABLE))
}

fn parse_approval(value: Option<&RegistryValue>) -> StartupApproval {
    match value {
        None => tenon_desktop::native::autostart::parse_approval(None),
        Some(RegistryValue::Binary(bytes)) => {
            tenon_desktop::native::autostart::parse_approval(Some(bytes))
        }
        _ => StartupApproval::Unknown,
    }
}

fn command_line(executable: &str, args: &[String]) -> Result<String, AppError> {
    let mut command = quote_argument(executable, true)?;
    for arg in args {
        command.push(' ');
        command.push_str(&quote_argument(arg, false)?);
    }
    Ok(command)
}

/// Windows CommandLineToArgvW 引用规则；exe 始终引用，参数按需要引用。
fn quote_argument(value: &str, force: bool) -> Result<String, AppError> {
    if value.contains('\0') {
        return Err(AppError::new(UNAVAILABLE));
    }
    if !force && !value.is_empty() && !value.contains([' ', '\t', '"']) {
        return Ok(value.into());
    }
    let mut quoted = String::from("\"");
    let mut slashes = 0;
    for character in value.chars() {
        match character {
            '\\' => slashes += 1,
            '"' => {
                quoted.extend(std::iter::repeat_n('\\', slashes * 2 + 1));
                quoted.push('"');
                slashes = 0;
            }
            _ => {
                quoted.extend(std::iter::repeat_n('\\', slashes));
                quoted.push(character);
                slashes = 0;
            }
        }
    }
    quoted.extend(std::iter::repeat_n('\\', slashes * 2));
    quoted.push('"');
    Ok(quoted)
}

#[cfg(windows)]
struct CurrentUserRegistry;

#[cfg(windows)]
fn optional<T>(result: windows_registry::Result<T>) -> Result<Option<T>, AppError> {
    match result {
        Ok(value) => Ok(Some(value)),
        Err(error) if matches!(error.code().0 as u32, 0x80070002 | 0x80070003) => Ok(None),
        Err(_) => Err(AppError::new(UNAVAILABLE)),
    }
}

#[cfg(windows)]
impl Registry for CurrentUserRegistry {
    fn read(&self, path: &str, name: &str) -> Result<Option<RegistryValue>, AppError> {
        optional(
            windows_registry::CURRENT_USER
                .open(path)
                .and_then(|key| key.get_value(name)),
        )
        .map(|value| {
            value.map(|value| match value.ty() {
                windows_registry::Type::String => RegistryValue::String(value.to_vec()),
                windows_registry::Type::Bytes => RegistryValue::Binary(value.to_vec()),
                _ => RegistryValue::Other,
            })
        })
    }

    fn write_string(&self, path: &str, name: &str, value: &str) -> Result<(), AppError> {
        windows_registry::CURRENT_USER
            .options()
            .write()
            .create()
            .open(path)
            .and_then(|key| key.set_string(name, value))
            .map_err(|_| AppError::new(UNAVAILABLE))
    }

    fn delete(&self, path: &str, name: &str) -> Result<(), AppError> {
        if let Some(key) = optional(windows_registry::CURRENT_USER.options().write().open(path))? {
            optional(key.remove_value(name))?;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{collections::BTreeMap, sync::Mutex};
    use tenon_desktop::native::autostart::{
        Autostart, AutostartScope, EffectiveStartup, ObservedBool,
    };

    #[derive(Default)]
    struct MemoryState {
        values: BTreeMap<(String, String), RegistryValue>,
        calls: Vec<(&'static str, String, String)>,
        failure: Option<&'static str>,
    }

    #[derive(Default)]
    struct Memory(Mutex<MemoryState>);

    fn string(value: &str) -> RegistryValue {
        RegistryValue::String(
            value
                .encode_utf16()
                .chain([0])
                .flat_map(u16::to_le_bytes)
                .collect(),
        )
    }

    impl Registry for Memory {
        fn read(&self, path: &str, name: &str) -> Result<Option<RegistryValue>, AppError> {
            let mut state = self.0.lock().unwrap();
            state.calls.push(("read", path.into(), name.into()));
            if (path == RUN && state.failure == Some("readRun"))
                || (path == APPROVAL && state.failure == Some("readApproval"))
            {
                return Err(AppError::new(UNAVAILABLE)
                    .with_source(std::io::Error::other("PRIVATE_REGISTRY_SENTINEL")));
            }
            Ok(state.values.get(&(path.into(), name.into())).cloned())
        }

        fn write_string(&self, path: &str, name: &str, value: &str) -> Result<(), AppError> {
            let mut state = self.0.lock().unwrap();
            state.calls.push(("write", path.into(), name.into()));
            if state.failure == Some("write") {
                return Err(AppError::new(UNAVAILABLE));
            }
            state
                .values
                .insert((path.into(), name.into()), string(value));
            Ok(())
        }

        fn delete(&self, path: &str, name: &str) -> Result<(), AppError> {
            let mut state = self.0.lock().unwrap();
            state.calls.push(("delete", path.into(), name.into()));
            if state.failure == Some("delete") {
                return Err(AppError::new(UNAVAILABLE));
            }
            state.values.remove(&(path.into(), name.into()));
            Ok(())
        }
    }

    fn adapter(memory: Arc<Memory>) -> SystemAutostart {
        SystemAutostart::with_registry(
            memory,
            "TenonTest-unit",
            r"C:\Program Files\Tenon\app.exe",
            &["--state-root".into(), r"C:\Temp\state dir\".into()],
        )
        .unwrap()
    }

    #[test]
    fn windows_command_line_quotes_every_boundary() {
        for (value, expected) in [
            ("", r#""""#),
            ("plain", "plain"),
            ("--state-root", "--state-root"),
            (r"plain\", r"plain\"),
            (r"C:\state dir\", r#""C:\state dir\\""#),
            (r#"say "hi""#, r#""say \"hi\"""#),
            (r#"a\"b"#, r#""a\\\"b""#),
            (r#"a\\"b"#, r#""a\\\\\"b""#),
            ("a\tb", "\"a\tb\""),
            ("中文 路径", "\"中文 路径\""),
        ] {
            assert_eq!(quote_argument(value, false).unwrap(), expected, "{value:?}");
        }
        assert_eq!(command_line(r"C:\app.exe", &[]).unwrap(), r#""C:\app.exe""#);
        assert_eq!(
            command_line(
                r"C:\Program Files\app.exe",
                &["--state-root".into(), r"C:\state dir\".into(), "".into()]
            )
            .unwrap(),
            r#""C:\Program Files\app.exe" --state-root "C:\state dir\\" """#
        );
        assert!(quote_argument("a\0b", false).is_err());
    }

    #[test]
    fn registration_parser_preserves_string_and_rejects_invalid_data() {
        assert!(matches!(
            parse_registration(None).unwrap(),
            Registration::NotRegistered
        ));
        for command in ["", r#""C:\original dir\app.exe" "original argument""#] {
            assert!(
                parse_registration(Some(string(command))).unwrap()
                    == Registration::Registered(command.into())
            );
        }
        for value in [
            RegistryValue::Other,
            RegistryValue::Binary(vec![]),
            RegistryValue::String(vec![1]),
            RegistryValue::String(vec![0, 0xd8, 0, 0]),
            string("a\0b"),
        ] {
            assert_eq!(
                parse_registration(Some(value)).err().unwrap().code(),
                UNAVAILABLE
            );
        }
    }

    #[test]
    fn startup_approved_parser_has_no_guessing() {
        assert_eq!(parse_approval(None), StartupApproval::Allowed);
        for (first, expected) in [
            (0x02, StartupApproval::Allowed),
            (0x06, StartupApproval::Allowed),
            (0x03, StartupApproval::Disabled),
            (0x07, StartupApproval::Disabled),
            (0x00, StartupApproval::Unknown),
            (0x01, StartupApproval::Unknown),
            (0x04, StartupApproval::Unknown),
            (0x05, StartupApproval::Unknown),
            (0xff, StartupApproval::Unknown),
        ] {
            let mut bytes = vec![0; 12];
            bytes[0] = first;
            assert_eq!(
                parse_approval(Some(&RegistryValue::Binary(bytes))),
                expected
            );
        }
        for length in [0, 1, 8, 11, 13, 16] {
            assert_eq!(
                parse_approval(Some(&RegistryValue::Binary(vec![0x02; length]))),
                StartupApproval::Unknown
            );
        }
        assert_eq!(
            parse_approval(Some(&string("allowed"))),
            StartupApproval::Unknown
        );
        assert_eq!(
            parse_approval(Some(&RegistryValue::Other)),
            StartupApproval::Unknown
        );
    }

    #[test]
    fn registry_adapter_only_mutates_its_run_value() {
        let memory = Arc::new(Memory::default());
        let adapter = adapter(memory.clone());
        assert!(memory.0.lock().unwrap().calls.is_empty());
        let mut bytes = vec![0; 12];
        bytes[0] = 0x03;
        {
            let mut state = memory.0.lock().unwrap();
            state.values.insert(
                (APPROVAL.into(), "TenonTest-unit".into()),
                RegistryValue::Binary(bytes.clone()),
            );
            state
                .values
                .insert((RUN.into(), "Other".into()), string("untouched"));
        }
        adapter.enable().unwrap();
        assert!(
            adapter.registered().unwrap()
                == Registration::Registered(
                    r#""C:\Program Files\Tenon\app.exe" --state-root "C:\Temp\state dir\\""#.into()
                )
        );
        assert_eq!(adapter.approval().unwrap(), StartupApproval::Disabled);
        adapter.disable().unwrap();
        adapter.disable().unwrap();
        assert!(matches!(
            adapter.registered().unwrap(),
            Registration::NotRegistered
        ));
        let state = memory.0.lock().unwrap();
        assert!(
            matches!(state.values.get(&(APPROVAL.into(), "TenonTest-unit".into())), Some(RegistryValue::Binary(actual)) if *actual == bytes)
        );
        assert!(
            parse_registration(state.values.get(&(RUN.into(), "Other".into())).cloned()).unwrap()
                == Registration::Registered("untouched".into())
        );
        assert!(
            state
                .calls
                .iter()
                .all(|(operation, path, name)| name == "TenonTest-unit"
                    && match *operation {
                        "read" => path == RUN || path == APPROVAL,
                        "write" | "delete" => path == RUN,
                        _ => false,
                    })
        );
    }

    #[test]
    fn registry_errors_do_not_become_absence_or_success() {
        let memory = Arc::new(Memory::default());
        let adapter = adapter(memory.clone());
        memory.0.lock().unwrap().failure = Some("write");
        assert!(adapter.enable().is_err());
        memory.0.lock().unwrap().failure = Some("delete");
        assert!(adapter.disable().is_err());
        memory.0.lock().unwrap().failure = Some("readRun");
        assert!(adapter.registered().is_err());
        memory.0.lock().unwrap().failure = Some("readApproval");
        assert!(adapter.approval().is_err());
    }

    #[test]
    fn registry_snapshot_compensation_does_not_reconstruct_old_arguments() {
        let memory = Arc::new(Memory::default());
        let old = r#""C:\old path\old.exe" "PRIVATE_OLD_ARGUMENT""#;
        memory
            .0
            .lock()
            .unwrap()
            .values
            .insert((RUN.into(), "TenonTest-unit".into()), string(old));
        let adapter = Arc::new(adapter(memory.clone()));
        let service = Autostart::new(AutostartScope::Product, Some(adapter.clone())).unwrap();
        let root = tempfile::tempdir().unwrap();
        std::fs::write(
            root.path().join("config.toml"),
            "[autostart]\nenabled=true\n",
        )
        .unwrap();
        let config = Mutex::new(tenon_desktop::config::load(root.path(), [], &[]).unwrap());
        std::fs::remove_file(root.path().join("config.toml")).unwrap();
        std::fs::create_dir(root.path().join("config.toml")).unwrap();
        assert!(service.update(&config, root.path(), false).is_err());
        assert!(adapter.registered().unwrap() == Registration::Registered(old.into()));
        let snapshot = service.settings(&config, "trace").unwrap();
        assert!(snapshot.desired.value);
        assert!(
            !serde_json::to_string(&snapshot)
                .unwrap()
                .contains("PRIVATE_OLD_ARGUMENT")
        );
    }

    #[test]
    fn registration_and_approval_are_observed_independently() {
        let memory = Arc::new(Memory::default());
        let adapter = Arc::new(adapter(memory.clone()));
        adapter.enable().unwrap();
        let service = Autostart::new(AutostartScope::Product, Some(adapter)).unwrap();
        let config = Mutex::new(
            tenon_desktop::config::load(tempfile::tempdir().unwrap().path(), [], &[]).unwrap(),
        );
        for (value, expected, effective) in [
            (None, StartupApproval::Allowed, EffectiveStartup::Enabled),
            (
                Some(RegistryValue::Binary([vec![0x07], vec![0; 11]].concat())),
                StartupApproval::Disabled,
                EffectiveStartup::Disabled,
            ),
            (
                Some(RegistryValue::Binary(vec![0x02; 3])),
                StartupApproval::Unknown,
                EffectiveStartup::Unknown,
            ),
        ] {
            let key = (APPROVAL.into(), "TenonTest-unit".into());
            if let Some(value) = value {
                memory.0.lock().unwrap().values.insert(key, value);
            } else {
                memory.0.lock().unwrap().values.remove(&key);
            }
            let snapshot = service.settings(&config, "trace").unwrap();
            assert!(matches!(
                snapshot.registered,
                ObservedBool::Known { value: true }
            ));
            assert_eq!(snapshot.approval, expected);
            assert_eq!(snapshot.effective_startup, effective);
        }
        memory.0.lock().unwrap().failure = Some("readApproval");
        let snapshot = service.settings(&config, "trace").unwrap();
        assert!(matches!(
            snapshot.registered,
            ObservedBool::Known { value: true }
        ));
        assert!(snapshot.approval_error.is_some());
        assert_eq!(snapshot.effective_startup, EffectiveStartup::Unknown);
        assert!(
            !serde_json::to_string(&snapshot)
                .unwrap()
                .contains("PRIVATE_REGISTRY_SENTINEL")
        );
        memory.0.lock().unwrap().failure = Some("readRun");
        assert!(matches!(
            service.settings(&config, "trace").unwrap().registered,
            ObservedBool::Unknown { .. }
        ));
    }
}
