//! Console 工作台布局、身份隔离与 revision 持久化；不保存业务正文。
use std::{
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

pub const INVALID: ErrorCode = ErrorCode::new("app.workbench.invalid");
pub const UNSUPPORTED: ErrorCode = ErrorCode::new("app.workbench.unsupported");
pub const READ_FAILED: ErrorCode = ErrorCode::new("app.workbench.read_failed");
pub const WRITE_FAILED: ErrorCode = ErrorCode::new("app.workbench.write_failed");
pub const CONFLICT: ErrorCode = ErrorCode::new("app.workbench.conflict");
pub const PRIMARY_MIN: u16 = 180;
pub const PRIMARY_MAX: u16 = 360;
pub const PRIMARY_COLLAPSED: u16 = 64;
pub const AUXILIARY_MIN: u16 = 240;
pub const AUXILIARY_MAX: u16 = 480;
const MAX_BYTES: u64 = 16 * 1024;
const DEFAULT_WORKSPACE: &str = "default";

#[derive(Clone, Debug, PartialEq, Eq, Deserialize, Serialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AuxiliaryLayout {
    pub width: u16,
    pub visible: bool,
    #[serde(with = "Option")]
    #[ts(as = "Option<String>")]
    pub panel: Option<String>,
}

impl Default for AuxiliaryLayout {
    fn default() -> Self {
        Self {
            width: 320,
            visible: false,
            panel: None,
        }
    }
}

impl AuxiliaryLayout {
    fn validate(&self) -> Result<(), AppError> {
        if !(AUXILIARY_MIN..=AUXILIARY_MAX).contains(&self.width)
            || self.panel.as_ref().is_some_and(|panel| {
                !(1..=32).contains(&panel.len())
                    || !panel.bytes().all(|byte| {
                        byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-'
                    })
            })
        {
            return Err(AppError::new(INVALID));
        }
        Ok(())
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Deserialize, Serialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WorkbenchLayout {
    pub primary_width: u16,
    pub primary_collapsed: bool,
    pub auxiliary: AuxiliaryLayout,
}

impl Default for WorkbenchLayout {
    fn default() -> Self {
        Self {
            primary_width: 224,
            primary_collapsed: false,
            auxiliary: AuxiliaryLayout::default(),
        }
    }
}

impl WorkbenchLayout {
    fn validate(&self) -> Result<(), AppError> {
        if !(PRIMARY_MIN..=PRIMARY_MAX).contains(&self.primary_width) {
            return Err(AppError::new(INVALID));
        }
        self.auxiliary.validate()
    }
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Deserialize, Serialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WorkbenchLayouts {
    pub console: WorkbenchLayout,
}

#[derive(Clone, Debug, PartialEq, Eq, Deserialize, Serialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WorkbenchSnapshot {
    pub schema_version: u8,
    pub revision: u32,
    pub workspace_id: String,
    pub layouts: WorkbenchLayouts,
}

impl Default for WorkbenchSnapshot {
    fn default() -> Self {
        Self {
            schema_version: 1,
            revision: 0,
            workspace_id: DEFAULT_WORKSPACE.into(),
            layouts: WorkbenchLayouts::default(),
        }
    }
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "kebab-case")]
pub enum WorkbenchChangeKind {
    SetLayout,
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WorkbenchChange {
    pub kind: WorkbenchChangeKind,
    pub layout: WorkbenchLayoutChange,
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub enum WorkbenchLayoutChange {
    Console(WorkbenchLayout),
}

enum LayoutAction {
    Set(WorkbenchLayoutChange),
    Reset,
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WorkbenchUpdate {
    pub expected_revision: u32,
    pub change: WorkbenchChange,
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WorkbenchResetLayout {
    pub expected_revision: u32,
}

pub struct WorkbenchStore {
    root: PathBuf,
    scratch: PathBuf,
    write_lock: Mutex<()>,
}

impl WorkbenchStore {
    /// scratch 由宿主显式传入 <state-root>/Temp，原子替换要求与状态根同卷。
    pub fn new(state_root: &Path, scratch: &Path) -> Self {
        Self {
            root: state_root.join("workbench"),
            scratch: scratch.join("workbench"),
            write_lock: Mutex::new(()),
        }
    }

    fn path(&self, subject: Id, workspace: &str) -> PathBuf {
        let subject = format!("{:x}", Sha256::digest(subject.to_string().as_bytes()));
        let workspace = format!("{:x}", Sha256::digest(workspace.as_bytes()));
        self.root.join(subject).join(format!("{workspace}.json"))
    }

    fn read(&self, subject: Id, workspace: &str) -> Result<WorkbenchSnapshot, AppError> {
        let file = match fs::File::open(self.path(subject, workspace)) {
            Ok(file) => file,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                return Ok(WorkbenchSnapshot {
                    workspace_id: workspace.into(),
                    ..Default::default()
                });
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
        let snapshot: WorkbenchSnapshot =
            serde_json::from_slice(&bytes).map_err(|_| AppError::new(INVALID))?;
        if snapshot.schema_version != 1 {
            return Err(AppError::new(UNSUPPORTED));
        }
        if snapshot.workspace_id != workspace {
            return Err(AppError::new(INVALID));
        }
        snapshot.layouts.console.validate()?;
        Ok(snapshot)
    }

    fn write(
        &self,
        subject: Id,
        workspace: &str,
        expected_revision: u32,
        action: LayoutAction,
    ) -> Result<WorkbenchSnapshot, AppError> {
        let _lock = self
            .write_lock
            .lock()
            .map_err(|_| AppError::new(INTERNAL_UNEXPECTED))?;
        let mut snapshot = self.read(subject, workspace)?;
        if snapshot.revision != expected_revision {
            return Err(
                AppError::new(CONFLICT).with_param("revision", snapshot.revision.to_string())
            );
        }
        match action {
            LayoutAction::Set(WorkbenchLayoutChange::Console(console)) => {
                console.validate()?;
                snapshot.layouts.console = console;
            }
            LayoutAction::Reset => snapshot.layouts = WorkbenchLayouts::default(),
        }
        snapshot.revision = snapshot
            .revision
            .checked_add(1)
            .ok_or_else(|| AppError::new(INVALID))?;
        let path = self.path(subject, workspace);
        let directory = path
            .parent()
            .ok_or_else(|| AppError::new(INTERNAL_UNEXPECTED))?;
        create_directory(directory).map_err(|_| AppError::new(WRITE_FAILED))?;
        create_directory(&self.scratch).map_err(|_| AppError::new(WRITE_FAILED))?;
        let mut temporary = tempfile::NamedTempFile::new_in(&self.scratch)
            .map_err(|_| AppError::new(WRITE_FAILED))?;
        let bytes = serde_json::to_vec(&snapshot).map_err(|_| AppError::new(INVALID))?;
        if bytes.len() as u64 > MAX_BYTES {
            return Err(AppError::new(INVALID));
        }
        temporary
            .write_all(&bytes)
            .map_err(|_| AppError::new(WRITE_FAILED))?;
        temporary
            .as_file()
            .sync_all()
            .map_err(|_| AppError::new(WRITE_FAILED))?;
        temporary
            .persist(path)
            .map_err(|_| AppError::new(WRITE_FAILED))?;
        Ok(snapshot)
    }
}

impl WorkbenchStore {
    /// 宿主须在活动身份许可内调用，subject 不得来自 IPC 输入。
    pub fn get(&self, subject: Id) -> Result<WorkbenchSnapshot, AppError> {
        self.read(subject, DEFAULT_WORKSPACE)
    }

    pub fn update(
        &self,
        subject: Id,
        input: WorkbenchUpdate,
    ) -> Result<WorkbenchSnapshot, AppError> {
        let WorkbenchChange {
            kind: WorkbenchChangeKind::SetLayout,
            layout,
        } = input.change;
        self.write(
            subject,
            DEFAULT_WORKSPACE,
            input.expected_revision,
            LayoutAction::Set(layout),
        )
    }

    pub fn reset_layout(
        &self,
        subject: Id,
        input: WorkbenchResetLayout,
    ) -> Result<WorkbenchSnapshot, AppError> {
        self.write(
            subject,
            DEFAULT_WORKSPACE,
            input.expected_revision,
            LayoutAction::Reset,
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn concurrent_updates_conflict_and_staging_failure_keeps_saved_revision() {
        use std::sync::{Arc, Barrier};
        let (root, store) = store();
        let store = Arc::new(store);
        let subject = Id::new();
        let barrier = Arc::new(Barrier::new(2));
        let handles: Vec<_> = (0..2)
            .map(|_| {
                let store = store.clone();
                let barrier = barrier.clone();
                std::thread::spawn(move || {
                    barrier.wait();
                    store.reset_layout(
                        subject,
                        WorkbenchResetLayout {
                            expected_revision: 0,
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
        let saved = store.get(subject).unwrap();
        assert_eq!(store.scratch, root.path().join("Temp/workbench"));
        assert_eq!(fs::read_dir(&store.scratch).unwrap().count(), 0);
        fs::remove_dir(&store.scratch).unwrap();
        fs::write(&store.scratch, b"blocked scratch").unwrap();
        assert_eq!(
            store
                .reset_layout(
                    subject,
                    WorkbenchResetLayout {
                        expected_revision: 1
                    }
                )
                .unwrap_err()
                .code(),
            WRITE_FAILED
        );
        assert_eq!(store.get(subject).unwrap(), saved);
        assert_eq!(
            fs::read_dir(store.path(subject, DEFAULT_WORKSPACE).parent().unwrap())
                .unwrap()
                .count(),
            1
        );
    }

    #[test]
    #[cfg(windows)]
    fn failed_atomic_replace_preserves_snapshot_and_cleans_scratch() {
        let (_root, store) = store();
        let subject = Id::new();
        let saved = store
            .reset_layout(
                subject,
                WorkbenchResetLayout {
                    expected_revision: 0,
                },
            )
            .unwrap();
        let path = store.path(subject, DEFAULT_WORKSPACE);
        let permissions = fs::metadata(&path).unwrap().permissions();
        let mut readonly = permissions.clone();
        readonly.set_readonly(true);
        fs::set_permissions(&path, readonly).unwrap();
        let result = store.reset_layout(
            subject,
            WorkbenchResetLayout {
                expected_revision: 1,
            },
        );
        fs::set_permissions(&path, permissions).unwrap();
        assert_eq!(result.unwrap_err().code(), WRITE_FAILED);
        assert_eq!(store.get(subject).unwrap(), saved);
        assert_eq!(fs::read_dir(&store.scratch).unwrap().count(), 0);
    }

    #[test]
    fn public_update_rejects_revision_overflow_and_linked_scratch() {
        let (root, store) = store();
        let subject = Id::new();
        let saved = store
            .update(
                subject,
                WorkbenchUpdate {
                    expected_revision: 0,
                    change: WorkbenchChange {
                        kind: WorkbenchChangeKind::SetLayout,
                        layout: WorkbenchLayoutChange::Console(WorkbenchLayout {
                            primary_width: 300,
                            ..Default::default()
                        }),
                    },
                },
            )
            .unwrap();
        assert_eq!(saved.layouts.console.primary_width, 300);
        let mut overflow = saved.clone();
        overflow.revision = u32::MAX;
        fs::write(
            store.path(subject, DEFAULT_WORKSPACE),
            serde_json::to_vec(&overflow).unwrap(),
        )
        .unwrap();
        assert_eq!(
            store
                .reset_layout(
                    subject,
                    WorkbenchResetLayout {
                        expected_revision: u32::MAX
                    }
                )
                .unwrap_err()
                .code(),
            INVALID
        );
        assert_eq!(store.get(subject).unwrap(), overflow);
        fs::remove_dir(&store.scratch).unwrap();
        let destination = root.path().join("linked-scratch");
        fs::create_dir(&destination).unwrap();
        crate::state_root::tests::link_directory(&destination, &store.scratch);
        let new_subject = Id::new();
        assert_eq!(
            store
                .reset_layout(
                    new_subject,
                    WorkbenchResetLayout {
                        expected_revision: 0
                    }
                )
                .unwrap_err()
                .code(),
            WRITE_FAILED
        );
        assert_eq!(fs::read_dir(destination).unwrap().count(), 0);
    }

    fn store() -> (tempfile::TempDir, WorkbenchStore) {
        let root = tempfile::Builder::new()
            .prefix("workbench-")
            .tempdir_in(std::env::temp_dir())
            .unwrap();
        let store = WorkbenchStore::new(root.path(), &root.path().join("Temp"));
        (root, store)
    }

    #[test]
    fn layout_is_subject_workspace_isolated() {
        let (_root, store) = store();
        let first = Id::new();
        let second = Id::new();
        let layout = WorkbenchLayout {
            primary_width: 300,
            primary_collapsed: true,
            auxiliary: AuxiliaryLayout::default(),
        };
        store
            .write(
                first,
                "../../one",
                0,
                LayoutAction::Set(WorkbenchLayoutChange::Console(layout.clone())),
            )
            .unwrap();
        assert_eq!(
            store.read(first, "../../one").unwrap().layouts.console,
            layout
        );
        assert_eq!(store.read(second, "../../one").unwrap().revision, 0);
        assert_eq!(store.read(first, "two").unwrap().revision, 0);
        let path = store.path(first, "../../one");
        assert!(path.starts_with(&store.root));
        assert_eq!(
            path.strip_prefix(&store.root).unwrap().components().count(),
            2
        );
        assert_eq!(path.file_stem().unwrap().len(), 64);
    }

    #[test]
    fn layout_revision_conflict_is_explicit() {
        let (_root, store) = store();
        let subject = Id::new();
        let saved = store
            .write(subject, "default", 0, LayoutAction::Reset)
            .unwrap();
        let error = store
            .write(
                subject,
                "default",
                0,
                LayoutAction::Set(WorkbenchLayoutChange::Console(WorkbenchLayout {
                    primary_width: 300,
                    primary_collapsed: false,
                    auxiliary: AuxiliaryLayout::default(),
                })),
            )
            .unwrap_err();
        assert_eq!(error.code(), CONFLICT);
        assert_eq!(store.read(subject, "default").unwrap(), saved);
    }

    #[test]
    fn invalid_files_and_out_of_range_writes_are_not_defaulted() {
        let (_root, store) = store();
        let subject = Id::new();
        for width in [0, 179, 361, u16::MAX] {
            assert_eq!(
                store
                    .write(
                        subject,
                        "default",
                        0,
                        LayoutAction::Set(WorkbenchLayoutChange::Console(WorkbenchLayout {
                            primary_width: width,
                            primary_collapsed: false,
                            auxiliary: AuxiliaryLayout::default(),
                        }))
                    )
                    .unwrap_err()
                    .code(),
                INVALID
            );
        }
        assert!(!store.root.exists());
        let saved = store
            .write(subject, "default", 0, LayoutAction::Reset)
            .unwrap();
        let path = store.path(subject, "default");
        fs::write(&path, "broken").unwrap();
        assert_eq!(store.read(subject, "default").unwrap_err().code(), INVALID);
        assert_eq!(
            store
                .write(subject, "default", 1, LayoutAction::Reset)
                .unwrap_err()
                .code(),
            INVALID
        );
        let mut newer = saved;
        newer.schema_version = 2;
        fs::write(&path, serde_json::to_vec(&newer).unwrap()).unwrap();
        assert_eq!(
            store.read(subject, "default").unwrap_err().code(),
            UNSUPPORTED
        );
        assert!(serde_json::from_str::<WorkbenchUpdate>(r#"{"expectedRevision":0,"change":{"kind":"set-layout","layout":{"console":{"primaryWidth":224,"primaryCollapsed":false}}},"subjectId":"someone"}"#).is_err());
    }

    #[test]
    fn console_layout_persists_and_resets() {
        let (_root, store) = store();
        let subject = Id::new();
        let console = WorkbenchLayout {
            primary_width: 300,
            primary_collapsed: true,
            auxiliary: AuxiliaryLayout::default(),
        };
        store
            .write(
                subject,
                "default",
                0,
                LayoutAction::Set(WorkbenchLayoutChange::Console(console.clone())),
            )
            .unwrap();
        let saved = store.read(subject, "default").unwrap();
        assert_eq!(saved.schema_version, 1);
        assert_eq!(saved.layouts.console, console);
        let reset = store
            .write(subject, "default", 1, LayoutAction::Reset)
            .unwrap();
        assert_eq!(reset.revision, 2);
        assert_eq!(reset.layouts, WorkbenchLayouts::default());
    }

    #[test]
    fn old_shape_unknown_fields_and_multiple_slots_are_rejected() {
        let console = serde_json::to_value(WorkbenchLayout::default()).unwrap();
        for layout in [
            serde_json::json!({"console":console,"studio":console}),
            serde_json::json!({"paper":console}),
            serde_json::json!({"studio":{"primaryWidth":240,"primaryCollapsed":false}}),
            serde_json::json!({"studio":{"primaryWidth":240,"primaryCollapsed":false,"statusBarVisible":true,"extra":0}}),
        ] {
            let input = serde_json::json!({
                "expectedRevision":0,"change":{"kind":"set-layout","layout":layout}
            });
            assert!(serde_json::from_value::<WorkbenchUpdate>(input).is_err());
        }
        let (_root, store) = store();
        let subject = Id::new();
        let saved = store
            .write(subject, "default", 0, LayoutAction::Reset)
            .unwrap();
        let path = store.path(subject, "default");
        let mut old = serde_json::to_value(&saved).unwrap();
        old["layouts"].as_object_mut().unwrap().remove("console");
        let bytes = serde_json::to_vec(&old).unwrap();
        fs::write(&path, &bytes).unwrap();
        assert_eq!(store.read(subject, "default").unwrap_err().code(), INVALID);
        assert_eq!(
            store
                .write(subject, "default", 1, LayoutAction::Reset)
                .unwrap_err()
                .code(),
            INVALID
        );
        assert_eq!(fs::read(&path).unwrap(), bytes);
        let mut unknown = serde_json::to_value(saved).unwrap();
        unknown["layouts"]["extra"] = serde_json::json!({});
        fs::write(&path, serde_json::to_vec(&unknown).unwrap()).unwrap();
        assert_eq!(store.read(subject, "default").unwrap_err().code(), INVALID);
        fs::write(&path, vec![b' '; MAX_BYTES as usize + 1]).unwrap();
        assert_eq!(store.read(subject, "default").unwrap_err().code(), INVALID);
    }

    #[test]
    fn auxiliary_slots_validate_persist_and_reset() {
        let (_root, store) = store();
        let subject = Id::new();
        let auxiliary = AuxiliaryLayout {
            width: AUXILIARY_MAX,
            visible: true,
            panel: Some("downstream-panel-1".into()),
        };
        let console = WorkbenchLayout {
            auxiliary: auxiliary.clone(),
            ..WorkbenchLayout::default()
        };
        let first = store
            .write(
                subject,
                DEFAULT_WORKSPACE,
                0,
                LayoutAction::Set(WorkbenchLayoutChange::Console(console.clone())),
            )
            .unwrap();
        assert_eq!(first.layouts.console, console);
        assert_eq!(store.read(subject, DEFAULT_WORKSPACE).unwrap(), first);
        assert_eq!(
            store.read(Id::new(), DEFAULT_WORKSPACE).unwrap(),
            WorkbenchSnapshot::default()
        );
        assert_eq!(
            store.read(subject, "another").unwrap().layouts,
            WorkbenchLayouts::default()
        );
        let reset = store
            .write(subject, DEFAULT_WORKSPACE, 1, LayoutAction::Reset)
            .unwrap();
        assert_eq!(reset.layouts, WorkbenchLayouts::default());
    }

    #[test]
    fn auxiliary_rejects_invalid_input_and_old_shapes_without_overwrite() {
        let (_root, store) = store();
        let subject = Id::new();
        let saved = store
            .write(subject, DEFAULT_WORKSPACE, 0, LayoutAction::Reset)
            .unwrap();
        let path = store.path(subject, DEFAULT_WORKSPACE);
        let original = fs::read(&path).unwrap();
        let mut invalid = vec![];
        for width in [0, 239, 481, u16::MAX] {
            invalid.push(AuxiliaryLayout {
                width,
                ..AuxiliaryLayout::default()
            });
        }
        for panel in ["", "Upper", "a.b", "a/b", "秘密", &"a".repeat(33)] {
            invalid.push(AuxiliaryLayout {
                panel: Some(panel.into()),
                ..AuxiliaryLayout::default()
            });
        }
        for auxiliary in invalid {
            let change = WorkbenchLayoutChange::Console(WorkbenchLayout {
                auxiliary,
                ..WorkbenchLayout::default()
            });
            assert_eq!(
                store
                    .write(subject, DEFAULT_WORKSPACE, 1, LayoutAction::Set(change))
                    .unwrap_err()
                    .code(),
                INVALID
            );
            assert_eq!(fs::read(&path).unwrap(), original);
        }
        for field in ["auxiliary", "width", "visible", "panel"] {
            let mut old = serde_json::to_value(&saved).unwrap();
            let target = if field == "auxiliary" {
                &mut old["layouts"]["console"]
            } else {
                &mut old["layouts"]["console"]["auxiliary"]
            };
            target.as_object_mut().unwrap().remove(field);
            let bytes = serde_json::to_vec(&old).unwrap();
            fs::write(&path, &bytes).unwrap();
            assert_eq!(
                store.read(subject, DEFAULT_WORKSPACE).unwrap_err().code(),
                INVALID
            );
            assert_eq!(
                store
                    .write(subject, DEFAULT_WORKSPACE, 1, LayoutAction::Reset)
                    .unwrap_err()
                    .code(),
                INVALID
            );
            assert_eq!(fs::read(&path).unwrap(), bytes);
        }
        assert!(
            AuxiliaryLayout {
                panel: Some("a".repeat(32)),
                ..AuxiliaryLayout::default()
            }
            .validate()
            .is_ok()
        );
        let mut unknown = serde_json::to_value(AuxiliaryLayout::default()).unwrap();
        unknown["title"] = serde_json::json!("not allowed");
        assert!(serde_json::from_value::<AuxiliaryLayout>(unknown).is_err());
    }
}
