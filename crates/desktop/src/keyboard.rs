//! 应用内快捷键覆盖与独立 v1/revision 文件；系统全局快捷键不属于本服务。
//! 宿主在活动身份许可内读取，在 owner 校验和活动身份许可内写入；subject 不来自 IPC。
use std::{
    collections::HashSet,
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::Mutex,
};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tenon_framework::{
    error::{AppError, ErrorCode, INTERNAL_UNEXPECTED},
    id::Id,
};
use ts_rs::TS;

use crate::state_root::create_directory;

pub const INVALID: ErrorCode = ErrorCode::new("app.keyboard.invalid");
pub const UNSUPPORTED: ErrorCode = ErrorCode::new("app.keyboard.unsupported");
pub const READ_FAILED: ErrorCode = ErrorCode::new("app.keyboard.read_failed");
pub const WRITE_FAILED: ErrorCode = ErrorCode::new("app.keyboard.write_failed");
pub const CONFLICT: ErrorCode = ErrorCode::new("app.keyboard.conflict");
const MAX_BYTES: u64 = 32 * 1024;
const MAX_BINDINGS: usize = 128;

#[derive(Clone, Debug, PartialEq, Eq, Deserialize, Serialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct KeyboardBinding {
    pub command_id: String,
    #[serde(with = "Option")]
    #[ts(as = "Option<String>")]
    pub keys: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Deserialize, Serialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct KeyboardSnapshot {
    pub schema_version: u8,
    pub revision: u32,
    pub bindings: Vec<KeyboardBinding>,
}

impl Default for KeyboardSnapshot {
    fn default() -> Self {
        Self {
            schema_version: 1,
            revision: 0,
            bindings: Vec::new(),
        }
    }
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct KeyboardUpdate {
    pub expected_revision: u32,
    pub bindings: Vec<KeyboardBinding>,
}

#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct KeyboardSettings {
    pub can_edit: bool,
    pub snapshot: KeyboardSnapshot,
}

fn valid_code(code: &str) -> bool {
    (code.len() == 4 && code.starts_with("Key") && code.as_bytes()[3].is_ascii_uppercase())
        || (code.len() == 6 && code.starts_with("Digit") && code.as_bytes()[5].is_ascii_digit())
        || (1..=12).any(|n| code == format!("F{n}"))
        || matches!(
            code,
            "ArrowUp"
                | "ArrowDown"
                | "ArrowLeft"
                | "ArrowRight"
                | "Home"
                | "End"
                | "PageUp"
                | "PageDown"
                | "Enter"
                | "Space"
                | "Comma"
                | "Period"
                | "Slash"
                | "Backslash"
                | "Semicolon"
                | "Quote"
                | "BracketLeft"
                | "BracketRight"
                | "Minus"
                | "Equal"
                | "Backquote"
        )
}

fn validate_keys(keys: &str) -> Result<(), AppError> {
    if keys.len() > 64 {
        return Err(AppError::new(INVALID));
    }
    let parts: Vec<_> = keys.split('+').collect();
    if !(2..=5).contains(&parts.len()) || !valid_code(parts[parts.len() - 1]) {
        return Err(AppError::new(INVALID));
    }
    let modifiers = &parts[..parts.len() - 1];
    let order = ["$mod", "Control", "Alt", "Shift"];
    let canonical: Vec<_> = order
        .into_iter()
        .filter(|item| modifiers.contains(item))
        .collect();
    if modifiers != canonical
        || (!modifiers.contains(&"$mod")
            && !modifiers.contains(&"Control")
            && !modifiers.contains(&"Alt"))
        || (modifiers.contains(&"$mod") && modifiers.contains(&"Control"))
    {
        return Err(AppError::new(INVALID));
    }
    let key = parts[parts.len() - 1];
    let primary = modifiers.contains(&"$mod") || modifiers.contains(&"Control");
    let alt = modifiers.contains(&"Alt");
    let shift = modifiers.contains(&"Shift");
    // Keep standard editing, application close, task switching and reload with the platform.
    if (primary
        && !alt
        && matches!(
            key,
            "KeyA" | "KeyC" | "KeyV" | "KeyX" | "KeyY" | "KeyZ" | "KeyQ" | "KeyW" | "KeyR"
        ))
        || (alt && !primary && key == "F4")
        || (primary && !alt && !shift && key == "Space")
    {
        return Err(AppError::new(INVALID));
    }
    Ok(())
}

fn validate(bindings: &[KeyboardBinding]) -> Result<(), AppError> {
    if bindings.len() > MAX_BINDINGS {
        return Err(AppError::new(INVALID));
    }
    let mut ids = HashSet::new();
    let mut keys = HashSet::new();
    for binding in bindings {
        if binding.command_id.is_empty()
            || binding.command_id.len() > 128
            || !binding
                .command_id
                .bytes()
                .all(|c| c.is_ascii_alphanumeric() || b"._:/-".contains(&c))
            || !ids.insert(&binding.command_id)
        {
            return Err(AppError::new(INVALID));
        }
        if let Some(value) = &binding.keys {
            validate_keys(value)?;
            // $mod is Control on Windows/Linux, so portable duplicates are rejected too.
            if !keys.insert(value.replace("$mod", "Control")) {
                return Err(AppError::new(INVALID));
            }
        }
    }
    Ok(())
}

pub struct KeyboardStore {
    root: PathBuf,
    write_lock: Mutex<()>,
}

impl KeyboardStore {
    pub fn new(state_root: &Path) -> Self {
        Self {
            root: state_root.into(),
            write_lock: Mutex::new(()),
        }
    }

    fn path(&self, subject: Id) -> PathBuf {
        self.root.join("keyboard").join(format!(
            "{:x}.json",
            Sha256::digest(subject.to_string().as_bytes())
        ))
    }

    pub fn read(&self, subject: Id) -> Result<KeyboardSnapshot, AppError> {
        let file = match fs::File::open(self.path(subject)) {
            Ok(file) => file,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                return Ok(KeyboardSnapshot::default());
            }
            Err(_) => return Err(AppError::new(READ_FAILED)),
        };
        let mut bytes = Vec::new();
        file.take(MAX_BYTES + 1)
            .read_to_end(&mut bytes)
            .map_err(|_| AppError::new(READ_FAILED))?;
        if bytes.len() as u64 > MAX_BYTES {
            return Err(AppError::new(INVALID));
        }
        let snapshot: KeyboardSnapshot =
            serde_json::from_slice(&bytes).map_err(|_| AppError::new(INVALID))?;
        if snapshot.schema_version != 1 {
            return Err(AppError::new(UNSUPPORTED));
        }
        validate(&snapshot.bindings)?;
        Ok(snapshot)
    }

    pub fn write(&self, subject: Id, input: KeyboardUpdate) -> Result<KeyboardSnapshot, AppError> {
        validate(&input.bindings)?;
        let _lock = self
            .write_lock
            .lock()
            .map_err(|_| AppError::new(INTERNAL_UNEXPECTED))?;
        let current = self.read(subject)?;
        if current.revision != input.expected_revision {
            return Err(AppError::new(CONFLICT));
        }
        let saved = KeyboardSnapshot {
            schema_version: 1,
            revision: current
                .revision
                .checked_add(1)
                .ok_or_else(|| AppError::new(INVALID))?,
            bindings: input.bindings,
        };
        let bytes = serde_json::to_vec(&saved).map_err(|_| AppError::new(INVALID))?;
        if bytes.len() as u64 > MAX_BYTES {
            return Err(AppError::new(INVALID));
        }
        create_directory(&self.root.join("keyboard")).map_err(|_| AppError::new(WRITE_FAILED))?;
        let scratch = self.root.join("Temp").join("keyboard");
        create_directory(&scratch).map_err(|_| AppError::new(WRITE_FAILED))?;
        let mut temporary =
            tempfile::NamedTempFile::new_in(&scratch).map_err(|_| AppError::new(WRITE_FAILED))?;
        temporary
            .write_all(&bytes)
            .map_err(|_| AppError::new(WRITE_FAILED))?;
        temporary
            .as_file()
            .sync_all()
            .map_err(|_| AppError::new(WRITE_FAILED))?;
        temporary
            .persist(self.path(subject))
            .map_err(|_| AppError::new(WRITE_FAILED))?;
        Ok(saved)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn concurrent_writes_and_failed_staging_preserve_revision() {
        use std::sync::{Arc, Barrier};
        let root = tempfile::tempdir().unwrap();
        let store = Arc::new(KeyboardStore::new(root.path()));
        let subject = Id::new();
        let barrier = Arc::new(Barrier::new(2));
        let handles: Vec<_> = (0..2)
            .map(|_| {
                let store = store.clone();
                let barrier = barrier.clone();
                std::thread::spawn(move || {
                    barrier.wait();
                    store.write(
                        subject,
                        KeyboardUpdate {
                            expected_revision: 0,
                            bindings: vec![],
                        },
                    )
                })
            })
            .collect();
        let results: Vec<_> = handles
            .into_iter()
            .map(|handle| handle.join().unwrap())
            .collect();
        assert_eq!(results.iter().filter(|result| result.is_ok()).count(), 1);
        assert_eq!(
            results.into_iter().find_map(Result::err).unwrap().code(),
            CONFLICT
        );
        let saved = store.read(subject).unwrap();
        let scratch = root.path().join("Temp/keyboard");
        assert_eq!(fs::read_dir(&scratch).unwrap().count(), 0);
        fs::remove_dir(&scratch).unwrap();
        fs::write(&scratch, b"blocked").unwrap();
        assert_eq!(
            store
                .write(
                    subject,
                    KeyboardUpdate {
                        expected_revision: 1,
                        bindings: vec![]
                    }
                )
                .unwrap_err()
                .code(),
            WRITE_FAILED
        );
        assert_eq!(store.read(subject).unwrap(), saved);
        let mut overflow = saved;
        overflow.revision = u32::MAX;
        fs::write(store.path(subject), serde_json::to_vec(&overflow).unwrap()).unwrap();
        assert_eq!(
            store
                .write(
                    subject,
                    KeyboardUpdate {
                        expected_revision: u32::MAX,
                        bindings: vec![]
                    }
                )
                .unwrap_err()
                .code(),
            INVALID
        );
        assert_eq!(store.read(subject).unwrap(), overflow);
    }

    #[test]
    #[cfg(windows)]
    fn failed_atomic_replace_keeps_bindings_and_cleans_scratch() {
        let root = tempfile::tempdir().unwrap();
        let store = KeyboardStore::new(root.path());
        let subject = Id::new();
        let saved = store
            .write(
                subject,
                KeyboardUpdate {
                    expected_revision: 0,
                    bindings: vec![binding("app.palette", Some("$mod+KeyK"))],
                },
            )
            .unwrap();
        let path = store.path(subject);
        let permissions = fs::metadata(&path).unwrap().permissions();
        let mut readonly = permissions.clone();
        readonly.set_readonly(true);
        fs::set_permissions(&path, readonly).unwrap();
        let result = store.write(
            subject,
            KeyboardUpdate {
                expected_revision: 1,
                bindings: vec![],
            },
        );
        fs::set_permissions(&path, permissions).unwrap();
        assert_eq!(result.unwrap_err().code(), WRITE_FAILED);
        assert_eq!(store.read(subject).unwrap(), saved);
        assert_eq!(
            fs::read_dir(root.path().join("Temp/keyboard"))
                .unwrap()
                .count(),
            0
        );
    }

    fn binding(command: &str, keys: Option<&str>) -> KeyboardBinding {
        KeyboardBinding {
            command_id: command.into(),
            keys: keys.map(str::to_owned),
        }
    }

    #[test]
    fn canonical_portable_single_combinations_and_disabled_entries() {
        for keys in ["$mod+KeyK", "Alt+Shift+Digit2", "Control+Shift+F2"] {
            assert!(validate(&[binding("nav:/settings/general", Some(keys))]).is_ok());
        }
        assert!(validate(&[binding("app.palette", None)]).is_ok());
        for keys in [
            "KeyK",
            "Shift+KeyK",
            "$mod+k",
            "$mod+KeyC",
            "$mod+Shift+KeyZ",
            "Alt+F4",
            "$mod+Control+KeyK",
            "Shift+Alt+KeyK",
            "$mod+KeyK $mod+KeyG",
            "$mod+(.*)",
        ] {
            assert_eq!(
                validate(&[binding("app.palette", Some(keys))])
                    .unwrap_err()
                    .code(),
                INVALID,
                "{keys}"
            );
        }
        assert!(
            validate(&[
                binding("a", Some("$mod+KeyK")),
                binding("b", Some("Control+KeyK"))
            ])
            .is_err()
        );
        assert!(validate(&[binding("a", None), binding("a", None)]).is_err());
        assert!(validate(&vec![binding("a", None); MAX_BINDINGS + 1]).is_err());
    }

    #[test]
    fn subject_isolation_revision_reset_and_bad_file_protection() {
        let root = tempfile::Builder::new()
            .prefix("keyboard-")
            .tempdir_in(std::env::temp_dir())
            .unwrap();
        let store = KeyboardStore::new(root.path());
        let first = Id::new();
        let second = Id::new();
        let saved = store
            .write(
                first,
                KeyboardUpdate {
                    expected_revision: 0,
                    bindings: vec![binding("app.palette", Some("$mod+Shift+KeyK"))],
                },
            )
            .unwrap();
        assert_eq!(store.read(first).unwrap(), saved);
        assert_eq!(store.read(second).unwrap(), KeyboardSnapshot::default());
        assert_eq!(
            store
                .write(
                    first,
                    KeyboardUpdate {
                        expected_revision: 0,
                        bindings: vec![]
                    }
                )
                .unwrap_err()
                .code(),
            CONFLICT
        );
        let reset = store
            .write(
                first,
                KeyboardUpdate {
                    expected_revision: 1,
                    bindings: vec![],
                },
            )
            .unwrap();
        assert_eq!(reset.revision, 2);
        assert!(reset.bindings.is_empty());
        fs::write(store.path(first), b"broken").unwrap();
        assert_eq!(
            store
                .write(
                    first,
                    KeyboardUpdate {
                        expected_revision: 2,
                        bindings: vec![]
                    }
                )
                .unwrap_err()
                .code(),
            INVALID
        );
        assert_eq!(fs::read(store.path(first)).unwrap(), b"broken");
        let mut newer = reset;
        newer.schema_version = 2;
        fs::write(store.path(first), serde_json::to_vec(&newer).unwrap()).unwrap();
        assert_eq!(store.read(first).unwrap_err().code(), UNSUPPORTED);
        fs::write(store.path(first), vec![b' '; MAX_BYTES as usize + 1]).unwrap();
        assert_eq!(store.read(first).unwrap_err().code(), INVALID);
    }
}
