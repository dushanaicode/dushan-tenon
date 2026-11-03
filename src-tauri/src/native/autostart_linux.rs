//! XDG autostart for this product only; user desktop policy is read, not rewritten.
use std::{
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
};

use glib::{KeyFile, KeyFileFlags};
use tenon_framework::error::AppError;

use tenon_desktop::native::{
    UNAVAILABLE,
    autostart::{AutostartAdapter, Registration, StartupApproval},
};

const GROUP: &str = "Desktop Entry";
const LIMIT: u64 = 64 * 1024;

pub struct SystemXdgAutostart {
    path: PathBuf,
    scratch: PathBuf,
    product: String,
    name: String,
    executable: String,
    desktops: Vec<String>,
}

impl SystemXdgAutostart {
    /// Paths are resolved by the host only after the installed/default-root gate.
    pub fn new(
        config_directory: &Path,
        scratch: PathBuf,
        product: &str,
        name: &str,
        executable: &Path,
        desktop: &str,
    ) -> Result<Self, AppError> {
        let executable = executable
            .to_str()
            .ok_or_else(|| AppError::new(UNAVAILABLE))?;
        if !config_directory.is_absolute()
            || !scratch.is_absolute()
            || !Path::new(executable).is_absolute()
            || product.is_empty()
            || !product
                .bytes()
                .all(|c| c.is_ascii_alphanumeric() || b".-_".contains(&c))
            || executable.contains(['\0', '\r', '\n'])
            || name.contains(['\0', '\r', '\n'])
        {
            return Err(AppError::new(UNAVAILABLE));
        }
        Ok(Self {
            path: config_directory
                .join("autostart")
                .join(format!("{product}.desktop")),
            scratch,
            product: product.into(),
            name: name.into(),
            executable: executable.into(),
            desktops: desktop
                .split(':')
                .filter(|s| !s.is_empty())
                .map(str::to_owned)
                .collect(),
        })
    }

    fn read(&self) -> Result<Option<String>, AppError> {
        let metadata = match fs::symlink_metadata(&self.path) {
            Ok(metadata) => metadata,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(_) => return Err(AppError::new(UNAVAILABLE)),
        };
        if !metadata.is_file() || metadata.len() > LIMIT {
            return Err(AppError::new(UNAVAILABLE));
        }
        let mut content = String::new();
        fs::File::open(&self.path)
            .and_then(|f| f.take(LIMIT + 1).read_to_string(&mut content))
            .map_err(|_| AppError::new(UNAVAILABLE))?;
        if content.len() as u64 > LIMIT {
            return Err(AppError::new(UNAVAILABLE));
        }
        self.parse(&content)?;
        Ok(Some(content))
    }

    fn parse(&self, content: &str) -> Result<KeyFile, AppError> {
        let file = KeyFile::new();
        file.load_from_data(content, KeyFileFlags::NONE)
            .map_err(|_| AppError::new(UNAVAILABLE))?;
        if file
            .string(GROUP, "Type")
            .map_err(|_| AppError::new(UNAVAILABLE))?
            .as_str()
            != "Application"
            || file
                .string(GROUP, "X-Tenon-ProductId")
                .map_err(|_| AppError::new(UNAVAILABLE))?
                .as_str()
                != self.product
        {
            return Err(AppError::new(UNAVAILABLE));
        }
        Ok(file)
    }

    fn content(&self) -> String {
        let file = KeyFile::new();
        file.set_string(GROUP, "Type", "Application");
        file.set_string(GROUP, "Name", &self.name);
        file.set_string(GROUP, "X-Tenon-ProductId", &self.product);
        file.set_string(GROUP, "Exec", &exec_argument(&self.executable));
        file.set_boolean(GROUP, "Terminal", false);
        file.set_boolean(GROUP, "StartupNotify", false);
        file.to_data().into()
    }

    fn write(&self, content: &str) -> Result<(), AppError> {
        self.parse(content)?;
        self.read()?;
        fs::create_dir_all(
            self.path
                .parent()
                .ok_or_else(|| AppError::new(UNAVAILABLE))?,
        )
        .map_err(|_| AppError::new(UNAVAILABLE))?;
        fs::create_dir_all(&self.scratch).map_err(|_| AppError::new(UNAVAILABLE))?;
        let mut stage = tempfile::NamedTempFile::new_in(&self.scratch)
            .map_err(|_| AppError::new(UNAVAILABLE))?;
        stage
            .write_all(content.as_bytes())
            .and_then(|_| stage.as_file().sync_all())
            .map_err(|_| AppError::new(UNAVAILABLE))?;
        stage
            .persist(&self.path)
            .map_err(|_| AppError::new(UNAVAILABLE))?;
        Ok(())
    }

    fn remove(&self) -> Result<(), AppError> {
        if self.read()?.is_some() {
            fs::remove_file(&self.path).map_err(|_| AppError::new(UNAVAILABLE))?;
        }
        Ok(())
    }
}

// Exec has its own quoted-argument grammar; KeyFile handles the outer INI escaping.
fn exec_argument(path: &str) -> String {
    let mut quoted = String::from("\"");
    for ch in path.chars() {
        if matches!(ch, '\\' | '"' | '`' | '$') {
            quoted.push('\\');
        }
        if ch == '%' {
            quoted.push('%');
        }
        quoted.push(ch);
    }
    quoted.push('"');
    quoted
}

impl AutostartAdapter for SystemXdgAutostart {
    fn registered(&self) -> Result<Registration, AppError> {
        Ok(self
            .read()?
            .map_or(Registration::NotRegistered, Registration::Registered))
    }

    fn approval(&self) -> Result<StartupApproval, AppError> {
        let Some(content) = self.read()? else {
            return Ok(StartupApproval::Disabled);
        };
        let file = self.parse(&content)?;
        for (key, disabled) in [("Hidden", true), ("X-GNOME-Autostart-enabled", false)] {
            if file
                .has_key(GROUP, key)
                .map_err(|_| AppError::new(UNAVAILABLE))?
                && file
                    .boolean(GROUP, key)
                    .map_err(|_| AppError::new(UNAVAILABLE))?
                    == disabled
            {
                return Ok(StartupApproval::Disabled);
            }
        }
        for (key, inclusion) in [("OnlyShowIn", true), ("NotShowIn", false)] {
            if file
                .has_key(GROUP, key)
                .map_err(|_| AppError::new(UNAVAILABLE))?
            {
                if self.desktops.is_empty() {
                    return Ok(StartupApproval::Unknown);
                }
                let values = file
                    .string_list(GROUP, key)
                    .map_err(|_| AppError::new(UNAVAILABLE))?;
                let included = values.iter().any(|value| {
                    self.desktops
                        .iter()
                        .any(|desktop| desktop == value.as_str())
                });
                if included != inclusion {
                    return Ok(StartupApproval::Disabled);
                }
            }
        }
        if file
            .string(GROUP, "Exec")
            .map_err(|_| AppError::new(UNAVAILABLE))?
            .as_str()
            != exec_argument(&self.executable)
        {
            return Ok(StartupApproval::Unknown);
        }
        if file
            .has_key(GROUP, "TryExec")
            .map_err(|_| AppError::new(UNAVAILABLE))?
        {
            let path = file
                .string(GROUP, "TryExec")
                .map_err(|_| AppError::new(UNAVAILABLE))?;
            if glib::find_program_in_path(path.as_str()).is_none() {
                return Ok(StartupApproval::Disabled);
            }
        }
        Ok(StartupApproval::Allowed)
    }

    fn set_registered(&self, enabled: bool) -> Result<Registration, AppError> {
        if enabled {
            self.write(&self.content())?;
        } else {
            self.remove()?;
        }
        self.registered()
    }

    fn restore(&self, snapshot: &Registration) -> Result<(), AppError> {
        match snapshot {
            Registration::Registered(content) => self.write(content),
            Registration::NotRegistered => self.remove(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture(root: &Path) -> SystemXdgAutostart {
        SystemXdgAutostart::new(
            &root.join("config"),
            root.join("scratch"),
            "test.tenon",
            "Test & 中文",
            &root.join("App $\"% \\ file"),
            "GNOME:Unity",
        )
        .unwrap()
    }

    #[test]
    fn xdg_registration_roundtrips_policy_and_exact_compensation() {
        let root = tempfile::tempdir_in(std::env::temp_dir()).unwrap();
        let adapter = fixture(root.path());
        assert!(matches!(
            adapter.registered().unwrap(),
            Registration::NotRegistered
        ));
        adapter.set_registered(true).unwrap();
        let content = adapter.read().unwrap().unwrap();
        let parsed = adapter.parse(&content).unwrap();
        assert_eq!(
            parsed.string(GROUP, "Exec").unwrap(),
            exec_argument(&adapter.executable)
        );
        let arguments =
            glib::shell_parse_argv(parsed.string(GROUP, "Exec").unwrap().as_str()).unwrap();
        assert_eq!(arguments.len(), 1);
        assert_eq!(
            arguments[0].to_str().unwrap(),
            adapter.executable.replace('%', "%%")
        );
        assert!(content.contains("%%"));
        parsed.set_boolean(GROUP, "Hidden", true);
        adapter.write(parsed.to_data().as_str()).unwrap();
        let original = adapter.registered().unwrap();
        assert!(matches!(
            adapter.approval().unwrap(),
            StartupApproval::Disabled
        ));
        adapter.set_registered(false).unwrap();
        adapter.restore(&original).unwrap();
        assert!(adapter.registered().unwrap() == original);
        assert!(matches!(
            adapter.approval().unwrap(),
            StartupApproval::Disabled
        ));
        let file = adapter.parse(&adapter.read().unwrap().unwrap()).unwrap();
        file.remove_key(GROUP, "Hidden").unwrap();
        file.set_string(GROUP, "OnlyShowIn", "KDE;");
        adapter.write(file.to_data().as_str()).unwrap();
        assert!(matches!(
            adapter.approval().unwrap(),
            StartupApproval::Disabled
        ));
    }

    #[test]
    fn xdg_refuses_foreign_or_oversized_registration_and_keeps_it() {
        let root = tempfile::tempdir_in(std::env::temp_dir()).unwrap();
        let adapter = fixture(root.path());
        fs::create_dir_all(adapter.path.parent().unwrap()).unwrap();
        fs::write(
            &adapter.path,
            "[Desktop Entry]\nType=Application\nExec=/bin/true\n",
        )
        .unwrap();
        assert!(adapter.registered().is_err());
        assert!(adapter.set_registered(false).is_err());
        assert!(adapter.set_registered(true).is_err());
        assert!(adapter.path.exists());
        fs::write(&adapter.path, "x".repeat(LIMIT as usize + 1)).unwrap();
        assert!(adapter.registered().is_err());
    }
}
