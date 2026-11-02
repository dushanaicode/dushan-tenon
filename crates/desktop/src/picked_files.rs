//! 产品文件用途、一次性令牌与任务交接；路径只存在内存，原生对话框由宿主执行。

use std::{
    collections::BTreeMap,
    future::Future,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
};

use serde::{Deserialize, Serialize};
use tenon_framework::{
    actor::Actor,
    error::{AppError, ErrorCode, INPUT_INVALID, INTERNAL_UNEXPECTED},
    exchange::{ExchangeFormat, FORMAT_MISMATCH},
    time::Timestamp,
};
use ts_rs::TS;

pub const FILE_TOKEN_INVALID: ErrorCode = ErrorCode::new("app.exchange.file_token_invalid");
const TTL_MILLIS: i64 = 600_000;
// 交接中的任务有独立预算；过期条目在插入和交接时回收。
const MAX_HANDOFFS: usize = 16;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize, Serialize, TS)]
#[serde(rename_all = "lowercase")]
pub enum FilePurpose {
    BackupExport,
    BackupRestore,
    DiagnosticsExport,
    Export,
    Import,
    Store,
    Save,
}

impl FilePurpose {
    pub fn format(
        self,
        path: &Path,
        expected: Option<ExchangeFormat>,
    ) -> Result<Option<ExchangeFormat>, AppError> {
        match self {
            Self::DiagnosticsExport | Self::BackupExport | Self::BackupRestore => {
                let suffix = if self == Self::DiagnosticsExport {
                    ".tenon-diagnostics.zip"
                } else {
                    ".tenon-backup.zip"
                };
                if expected.is_some()
                    || !path
                        .file_name()
                        .and_then(|name| name.to_str())
                        .is_some_and(|name| name.ends_with(suffix))
                {
                    return Err(AppError::new(FORMAT_MISMATCH));
                }
                Ok(None)
            }
            Self::Export | Self::Import => {
                let extension = path
                    .extension()
                    .and_then(|ext| ext.to_str())
                    .ok_or_else(|| AppError::new(FORMAT_MISMATCH))?;
                let actual = ExchangeFormat::try_from(extension.to_ascii_lowercase())
                    .map_err(|_| AppError::new(FORMAT_MISMATCH))?;
                if expected.is_some_and(|format| format != actual) {
                    return Err(AppError::new(FORMAT_MISMATCH));
                }
                Ok(Some(actual))
            }
            Self::Store | Self::Save => Ok(None),
        }
    }
}

#[derive(Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FilePickInput {
    pub purpose: FilePurpose,
    #[ts(optional)]
    pub format: Option<ExchangeFormat>,
    #[ts(optional)]
    pub suggested_name: Option<String>,
    #[ts(optional)]
    pub extensions: Option<Vec<String>>,
}

#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct FilePicked {
    pub token: String,
    pub file_name: String,
    pub format: Option<ExchangeFormat>,
}

#[derive(Debug)]
pub struct PickedFile {
    pub path: PathBuf,
    pub format: Option<ExchangeFormat>,
}

struct Entry {
    actor: Actor,
    purpose: FilePurpose,
    path: PathBuf,
    expires: i64,
}

impl Entry {
    fn validate(&self, actor: Actor, purpose: FilePurpose, now: i64) -> Result<(), AppError> {
        if self.actor != actor || self.purpose != purpose || self.expires <= now {
            return Err(AppError::new(FILE_TOKEN_INVALID));
        }
        Ok(())
    }
}

#[derive(Default)]
struct Entries {
    picked: BTreeMap<String, Entry>,
    handoffs: BTreeMap<String, Entry>,
}

impl Entries {
    fn prune(&mut self, now: i64) {
        self.picked.retain(|_, entry| entry.expires > now);
        self.handoffs.retain(|_, entry| entry.expires > now);
    }
}

pub struct PickedFileStore {
    entries: Mutex<Entries>,
    clock: Arc<dyn Fn() -> Timestamp + Send + Sync>,
}

struct HandoffSubmission<'a> {
    entries: &'a Mutex<Entries>,
    handle: String,
    committed: bool,
}

impl Drop for HandoffSubmission<'_> {
    fn drop(&mut self) {
        if !self.committed {
            // 只释放本次交接资源；即使锁已中毒也撤销，正常服务调用仍返回中毒错误。
            let mut entries = match self.entries.lock() {
                Ok(entries) => entries,
                Err(poisoned) => poisoned.into_inner(),
            };
            entries.handoffs.remove(&self.handle);
        }
    }
}

impl Default for PickedFileStore {
    fn default() -> Self {
        Self::new(Timestamp::now)
    }
}

impl PickedFileStore {
    pub fn new(clock: impl Fn() -> Timestamp + Send + Sync + 'static) -> Self {
        Self {
            entries: Mutex::new(Entries::default()),
            clock: Arc::new(clock),
        }
    }

    pub fn revoke(&self, token: &str, actor: Actor) -> Result<(), AppError> {
        let mut entries = self
            .entries
            .lock()
            .map_err(|_| AppError::new(INTERNAL_UNEXPECTED))?;
        if entries
            .picked
            .get(token)
            .is_some_and(|entry| entry.actor == actor)
        {
            entries.picked.remove(token);
        }
        Ok(())
    }

    pub fn insert(
        &self,
        actor: Actor,
        purpose: FilePurpose,
        path: PathBuf,
        extensions: &[String],
    ) -> Result<FilePicked, AppError> {
        if matches!(purpose, FilePurpose::Store | FilePurpose::Save) {
            validate_extensions(purpose, extensions)?;
            let extension = path
                .extension()
                .and_then(|ext| ext.to_str())
                .map(str::to_ascii_lowercase);
            if !extension.is_some_and(|ext| extensions.contains(&ext)) {
                return Err(AppError::new(tenon_framework::file::TYPE_NOT_ALLOWED));
            }
        }
        let format = purpose.format(&path, None)?;
        let file_name = path
            .file_name()
            .and_then(|name| name.to_str())
            .ok_or_else(|| AppError::new(INPUT_INVALID).with_param("path", "file"))?
            .to_owned();
        let token = uuid::Uuid::new_v4().to_string();
        let now = (self.clock)().as_millis();
        let mut entries = self
            .entries
            .lock()
            .map_err(|_| AppError::new(INTERNAL_UNEXPECTED))?;
        entries.prune(now);
        entries.picked.insert(
            token.clone(),
            Entry {
                actor,
                purpose,
                path,
                expires: now + TTL_MILLIS,
            },
        );
        Ok(FilePicked {
            token,
            file_name,
            format,
        })
    }

    /// 任何消费尝试均销毁令牌，包括错 actor、用途、格式和过期。
    pub fn take(
        &self,
        token: &str,
        actor: Actor,
        purpose: FilePurpose,
        format: Option<ExchangeFormat>,
    ) -> Result<PickedFile, AppError> {
        let entry = self
            .entries
            .lock()
            .map_err(|_| AppError::new(INTERNAL_UNEXPECTED))?
            .picked
            .remove(token)
            .ok_or_else(|| AppError::new(FILE_TOKEN_INVALID))?;
        entry.validate(actor, purpose, (self.clock)().as_millis())?;
        let format = purpose.format(&entry.path, format)?;
        Ok(PickedFile {
            path: entry.path,
            format,
        })
    }

    /// 宿主把句柄写入任务 payload；提交返回失败时撤销句柄，不续期、不持久化路径。
    /// 仅用于导入/导出。任务 handler 通过 take_handoff 消费；提交等待被取消也撤销。
    pub async fn handoff<T, F: Future<Output = Result<T, AppError>>>(
        &self,
        token: &str,
        actor: Actor,
        purpose: FilePurpose,
        format: Option<ExchangeFormat>,
        submit: impl FnOnce(String) -> F,
    ) -> Result<T, AppError> {
        let handle = {
            let mut entries = self
                .entries
                .lock()
                .map_err(|_| AppError::new(INTERNAL_UNEXPECTED))?;
            let entry = entries
                .picked
                .remove(token)
                .ok_or_else(|| AppError::new(FILE_TOKEN_INVALID))?;
            let now = (self.clock)().as_millis();
            entry.validate(actor, purpose, now)?;
            if !matches!(purpose, FilePurpose::Export | FilePurpose::Import) {
                return Err(AppError::new(FILE_TOKEN_INVALID));
            }
            purpose.format(&entry.path, format)?;
            entries.prune(now);
            if entries.handoffs.len() >= MAX_HANDOFFS {
                return Err(AppError::new(INPUT_INVALID).with_param("path", "handoff"));
            }
            let handle = uuid::Uuid::new_v4().to_string();
            entries.handoffs.insert(handle.clone(), entry);
            handle
        };
        let mut submission = HandoffSubmission {
            entries: &self.entries,
            handle,
            committed: false,
        };
        let result = submit(submission.handle.clone()).await;
        submission.committed = result.is_ok();
        result
    }

    pub fn take_handoff(
        &self,
        handle: &str,
        actor: Actor,
        purpose: FilePurpose,
        format: Option<ExchangeFormat>,
    ) -> Result<PickedFile, AppError> {
        let entry = self
            .entries
            .lock()
            .map_err(|_| AppError::new(INTERNAL_UNEXPECTED))?
            .handoffs
            .remove(handle)
            .ok_or_else(|| AppError::new(FILE_TOKEN_INVALID))?;
        entry.validate(actor, purpose, (self.clock)().as_millis())?;
        let format = purpose.format(&entry.path, format)?;
        Ok(PickedFile {
            path: entry.path,
            format,
        })
    }
}

fn validate_extensions(purpose: FilePurpose, extensions: &[String]) -> Result<(), AppError> {
    if extensions.is_empty()
        || (purpose == FilePurpose::Save && extensions.len() != 1)
        || extensions.iter().any(|ext| {
            !(1..=16).contains(&ext.len())
                || !ext
                    .bytes()
                    .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit())
        })
    {
        return Err(AppError::new(INPUT_INVALID).with_param("path", "extensions"));
    }
    Ok(())
}

/// 原生对话框适配调用的纯过滤合同。
pub fn filters(input: &FilePickInput) -> Result<Vec<String>, AppError> {
    match input.purpose {
        FilePurpose::BackupExport | FilePurpose::BackupRestore | FilePurpose::DiagnosticsExport => {
            if input.format.is_some() || input.extensions.is_some() {
                return Err(AppError::new(INPUT_INVALID).with_param("path", "purpose"));
            }
            Ok(vec!["zip".into()])
        }
        FilePurpose::Store | FilePurpose::Save => {
            let extensions = input
                .extensions
                .as_deref()
                .ok_or_else(|| AppError::new(INPUT_INVALID).with_param("path", "extensions"))?;
            validate_extensions(input.purpose, extensions)?;
            Ok(extensions.to_vec())
        }
        FilePurpose::Export => Ok(vec![
            input
                .format
                .ok_or_else(|| AppError::new(INPUT_INVALID).with_param("path", "format"))?
                .extension()
                .into(),
        ]),
        FilePurpose::Import => Ok(vec!["xlsx".into(), "csv".into(), "json".into()]),
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use std::sync::atomic::{AtomicI64, Ordering};
    use tenon_framework::id::Id;

    pub(crate) fn assert_empty(store: &PickedFileStore) {
        let entries = store.entries.lock().unwrap();
        assert!(entries.picked.is_empty());
        assert!(entries.handoffs.is_empty());
    }

    fn clocked_store() -> (Arc<AtomicI64>, PickedFileStore) {
        let time = Arc::new(AtomicI64::new(1_000_000));
        let clock = time.clone();
        let store = PickedFileStore::new(move || {
            Timestamp::from_millis(clock.load(Ordering::SeqCst)).unwrap()
        });
        (time, store)
    }

    #[test]
    fn cancelled_submission_revokes_the_internal_handle() {
        use std::task::{Context, Poll, Waker};
        let (_, store) = clocked_store();
        let actor = Actor::User(Id::new());
        let file = store
            .insert(actor, FilePurpose::Import, "Temp/data.csv".into(), &[])
            .unwrap();
        let mut submission =
            Box::pin(
                store.handoff(&file.token, actor, FilePurpose::Import, None, |_| {
                    std::future::pending::<Result<(), AppError>>()
                }),
            );
        assert!(matches!(
            submission
                .as_mut()
                .poll(&mut Context::from_waker(Waker::noop())),
            Poll::Pending
        ));
        assert_eq!(store.entries.lock().unwrap().handoffs.len(), 1);
        drop(submission);
        assert_empty(&store);
    }

    #[tokio::test]
    async fn handoff_is_separate_single_use_actor_bound_and_keeps_original_expiry() {
        let (time, store) = clocked_store();
        let actor = Actor::User(Id::new());
        let file = store
            .insert(actor, FilePurpose::Export, "Temp/export.csv".into(), &[])
            .unwrap();
        time.fetch_add(TTL_MILLIS - 1, Ordering::SeqCst);
        let handle = store
            .handoff(
                &file.token,
                actor,
                FilePurpose::Export,
                Some(ExchangeFormat::Csv),
                |handle| async { Ok(handle) },
            )
            .await
            .unwrap();
        assert_ne!(handle, file.token);
        assert!(uuid::Uuid::parse_str(&handle).is_ok());
        assert_eq!(
            store
                .take(&handle, actor, FilePurpose::Export, None)
                .unwrap_err()
                .code(),
            FILE_TOKEN_INVALID
        );
        assert_eq!(
            store
                .take(&file.token, actor, FilePurpose::Export, None)
                .unwrap_err()
                .code(),
            FILE_TOKEN_INVALID
        );
        time.fetch_add(1, Ordering::SeqCst);
        assert_eq!(
            store
                .take_handoff(&handle, actor, FilePurpose::Export, None)
                .unwrap_err()
                .code(),
            FILE_TOKEN_INVALID
        );

        for purpose in [FilePurpose::Export, FilePurpose::Import] {
            let file = store
                .insert(actor, purpose, "Temp/data.json".into(), &[])
                .unwrap();
            let handle = store
                .handoff(&file.token, actor, purpose, None, |handle| async {
                    Ok(handle)
                })
                .await
                .unwrap();
            assert_eq!(
                PickedFileStore::default()
                    .take_handoff(&handle, actor, purpose, None)
                    .unwrap_err()
                    .code(),
                FILE_TOKEN_INVALID
            );
            let selected = store.take_handoff(&handle, actor, purpose, None).unwrap();
            assert_eq!(selected.path, PathBuf::from("Temp/data.json"));
            assert_eq!(selected.format, Some(ExchangeFormat::Json));
            assert_eq!(
                store
                    .take_handoff(&handle, actor, purpose, None)
                    .unwrap_err()
                    .code(),
                FILE_TOKEN_INVALID
            );
        }
    }

    #[tokio::test]
    async fn handoff_rejects_wrong_actor_purpose_format_and_revokes_failed_submission() {
        let (_, store) = clocked_store();
        let actor = Actor::User(Id::new());
        for (owner, purpose, format, code) in [
            (
                Actor::User(Id::new()),
                FilePurpose::Import,
                None,
                FILE_TOKEN_INVALID,
            ),
            (actor, FilePurpose::Export, None, FILE_TOKEN_INVALID),
            (
                actor,
                FilePurpose::Import,
                Some(ExchangeFormat::Json),
                FORMAT_MISMATCH,
            ),
        ] {
            let file = store
                .insert(actor, FilePurpose::Import, "Temp/data.csv".into(), &[])
                .unwrap();
            let result: Result<(), _> = store
                .handoff(&file.token, owner, purpose, format, |_| async {
                    panic!("invalid handoff submitted")
                })
                .await;
            assert_eq!(result.unwrap_err().code(), code);
            assert_eq!(
                store
                    .take(&file.token, actor, FilePurpose::Import, None)
                    .unwrap_err()
                    .code(),
                FILE_TOKEN_INVALID
            );

            let file = store
                .insert(actor, FilePurpose::Import, "Temp/data.csv".into(), &[])
                .unwrap();
            let handle = store
                .handoff(
                    &file.token,
                    actor,
                    FilePurpose::Import,
                    None,
                    |handle| async { Ok(handle) },
                )
                .await
                .unwrap();
            assert_eq!(
                store
                    .take_handoff(&handle, owner, purpose, format)
                    .unwrap_err()
                    .code(),
                code
            );
            assert_eq!(
                store
                    .take_handoff(&handle, actor, FilePurpose::Import, None)
                    .unwrap_err()
                    .code(),
                FILE_TOKEN_INVALID
            );
        }
        let file = store
            .insert(actor, FilePurpose::Import, "Temp/data.csv".into(), &[])
            .unwrap();
        let captured = Mutex::new(String::new());
        let result: Result<(), _> = store
            .handoff(&file.token, actor, FilePurpose::Import, None, |handle| {
                *captured.lock().unwrap() = handle;
                async { Err(AppError::new(INTERNAL_UNEXPECTED)) }
            })
            .await;
        assert_eq!(result.unwrap_err().code(), INTERNAL_UNEXPECTED);
        assert_eq!(
            store
                .take_handoff(
                    &captured.into_inner().unwrap(),
                    actor,
                    FilePurpose::Import,
                    None
                )
                .unwrap_err()
                .code(),
            FILE_TOKEN_INVALID
        );
        assert!(store.entries.lock().unwrap().handoffs.is_empty());
    }

    #[tokio::test]
    async fn handoff_budget_reclaims_expired_entries_and_rejects_non_exchange_purposes() {
        let (time, store) = clocked_store();
        let actor = Actor::User(Id::new());
        for _ in 0..MAX_HANDOFFS {
            let file = store
                .insert(actor, FilePurpose::Import, "Temp/data.csv".into(), &[])
                .unwrap();
            store
                .handoff(&file.token, actor, FilePurpose::Import, None, |_| async {
                    Ok(())
                })
                .await
                .unwrap();
        }
        let file = store
            .insert(actor, FilePurpose::Import, "Temp/data.csv".into(), &[])
            .unwrap();
        assert_eq!(
            store
                .handoff(&file.token, actor, FilePurpose::Import, None, |_| async {
                    Ok(())
                })
                .await
                .unwrap_err()
                .code(),
            INPUT_INVALID
        );
        time.fetch_add(TTL_MILLIS, Ordering::SeqCst);
        let file = store
            .insert(actor, FilePurpose::Import, "Temp/data.csv".into(), &[])
            .unwrap();
        store
            .handoff(&file.token, actor, FilePurpose::Import, None, |_| async {
                Ok(())
            })
            .await
            .unwrap();
        assert_eq!(store.entries.lock().unwrap().handoffs.len(), 1);
        let file = store
            .insert(
                actor,
                FilePurpose::Store,
                "Temp/data.csv".into(),
                &["csv".into()],
            )
            .unwrap();
        assert_eq!(
            store
                .handoff(&file.token, actor, FilePurpose::Store, None, |_| async {
                    Ok(())
                })
                .await
                .unwrap_err()
                .code(),
            FILE_TOKEN_INVALID
        );
    }

    #[test]
    fn backup_tokens_malformed_tokens_and_actor_scoped_revocation() {
        let (_, store) = clocked_store();
        let actor = Actor::User(Id::new());
        for purpose in [FilePurpose::BackupExport, FilePurpose::BackupRestore] {
            for path in [
                "Temp/plain.zip",
                "Temp/data.tenon-backup.ZIP",
                "Temp/data.tenon-diagnostics.zip",
            ] {
                assert_eq!(
                    store
                        .insert(actor, purpose, path.into(), &[])
                        .unwrap_err()
                        .code(),
                    FORMAT_MISMATCH
                );
            }
            let file = store
                .insert(actor, purpose, "Temp/data.tenon-backup.zip".into(), &[])
                .unwrap();
            store.revoke(&file.token, Actor::User(Id::new())).unwrap();
            assert!(
                store
                    .take(&file.token, actor, purpose, None)
                    .unwrap()
                    .format
                    .is_none()
            );
            let file = store
                .insert(actor, purpose, "Temp/data.tenon-backup.zip".into(), &[])
                .unwrap();
            store.revoke(&file.token, actor).unwrap();
            assert_eq!(
                store
                    .take(&file.token, actor, purpose, None)
                    .unwrap_err()
                    .code(),
                FILE_TOKEN_INVALID
            );
        }
        for token in [
            "",
            "../token",
            "not-a-token",
            "00000000-0000-0000-0000-000000000000",
        ] {
            assert_eq!(
                store
                    .take(token, actor, FilePurpose::Import, None)
                    .unwrap_err()
                    .code(),
                FILE_TOKEN_INVALID
            );
        }
    }

    #[test]
    fn concurrent_consumers_have_one_winner_and_poison_is_an_error() {
        let store = Arc::new(PickedFileStore::default());
        let actor = Actor::User(Id::new());
        let file = store
            .insert(actor, FilePurpose::Import, "Temp/data.csv".into(), &[])
            .unwrap();
        let handles: Vec<_> = (0..2)
            .map(|_| {
                let store = store.clone();
                let token = file.token.clone();
                std::thread::spawn(move || store.take(&token, actor, FilePurpose::Import, None))
            })
            .collect();
        let results: Vec<_> = handles
            .into_iter()
            .map(|handle| handle.join().unwrap())
            .collect();
        assert_eq!(results.iter().filter(|result| result.is_ok()).count(), 1);
        assert_eq!(
            results.into_iter().find_map(Result::err).unwrap().code(),
            FILE_TOKEN_INVALID
        );
        let poison = store.clone();
        assert!(
            std::thread::spawn(move || {
                let _guard = poison.entries.lock().unwrap();
                panic!("poison test");
            })
            .join()
            .is_err()
        );
        assert_eq!(
            store
                .take("missing", actor, FilePurpose::Import, None)
                .unwrap_err()
                .code(),
            INTERNAL_UNEXPECTED
        );
    }

    #[test]
    fn diagnostics_tokens_enforce_name_purpose_actor_expiry_and_single_use() {
        let time = Arc::new(AtomicI64::new(1_000_000));
        let clock = time.clone();
        let store = PickedFileStore::new(move || {
            Timestamp::from_millis(clock.load(Ordering::SeqCst)).unwrap()
        });
        let actor = Actor::User(Id::new());
        assert_eq!(
            serde_json::to_string(&FilePurpose::DiagnosticsExport).unwrap(),
            "\"diagnosticsexport\"",
        );
        for purpose in [
            FilePurpose::DiagnosticsExport,
            FilePurpose::BackupExport,
            FilePurpose::BackupRestore,
            FilePurpose::Save,
        ] {
            let token = store
                .insert(
                    actor,
                    FilePurpose::DiagnosticsExport,
                    "Temp/tenon.tenon-diagnostics.zip".into(),
                    &[],
                )
                .unwrap();
            let result = store.take(&token.token, actor, purpose, None);
            if purpose == FilePurpose::DiagnosticsExport {
                assert!(result.unwrap().format.is_none());
            } else {
                assert_eq!(result.err().unwrap().code(), FILE_TOKEN_INVALID);
            }
            assert_eq!(
                store
                    .take(&token.token, actor, purpose, None)
                    .err()
                    .unwrap()
                    .code(),
                FILE_TOKEN_INVALID
            );
        }
        for (owner, expired) in [(Actor::User(Id::new()), false), (actor, true)] {
            let token = store
                .insert(
                    actor,
                    FilePurpose::DiagnosticsExport,
                    "Temp/tenon.tenon-diagnostics.zip".into(),
                    &[],
                )
                .unwrap();
            if expired {
                time.fetch_add(600_000, Ordering::SeqCst);
            }
            assert_eq!(
                store
                    .take(&token.token, owner, FilePurpose::DiagnosticsExport, None)
                    .err()
                    .unwrap()
                    .code(),
                FILE_TOKEN_INVALID
            );
        }
        for path in [
            "Temp/tenon.zip",
            "Temp/tenon.tenon-backup.zip",
            "Temp/tenon.tenon-diagnostics.ZIP",
        ] {
            assert_eq!(
                store
                    .insert(actor, FilePurpose::DiagnosticsExport, path.into(), &[])
                    .err()
                    .unwrap()
                    .code(),
                FORMAT_MISMATCH
            );
        }
        let token = store
            .insert(
                actor,
                FilePurpose::DiagnosticsExport,
                "Temp/tenon.tenon-diagnostics.zip".into(),
                &[],
            )
            .unwrap();
        assert_eq!(
            store
                .take(
                    &token.token,
                    actor,
                    FilePurpose::DiagnosticsExport,
                    Some(ExchangeFormat::Json)
                )
                .err()
                .unwrap()
                .code(),
            FORMAT_MISMATCH
        );
        let mut input = FilePickInput {
            purpose: FilePurpose::DiagnosticsExport,
            format: None,
            suggested_name: None,
            extensions: None,
        };
        assert_eq!(filters(&input).unwrap(), ["zip"]);
        input.format = Some(ExchangeFormat::Json);
        assert_eq!(filters(&input).unwrap_err().code(), INPUT_INVALID);
        input.format = None;
        input.extensions = Some(vec!["zip".into()]);
        assert_eq!(filters(&input).unwrap_err().code(), INPUT_INVALID);
    }

    #[test]
    fn store_and_save_tokens_validate_extensions_and_keep_identity_expiry_and_single_use() {
        let time = Arc::new(AtomicI64::new(1_000_000));
        let clock = time.clone();
        let store = PickedFileStore::new(move || {
            Timestamp::from_millis(clock.load(Ordering::SeqCst)).unwrap()
        });
        let actor = Actor::User(Id::new());
        for purpose in [FilePurpose::Store, FilePurpose::Save] {
            let extensions = vec!["png".into()];
            for (owner, requested, expired) in [
                (actor, purpose, false),
                (Actor::User(Id::new()), purpose, false),
                (actor, FilePurpose::Import, false),
                (actor, purpose, true),
            ] {
                let token = store
                    .insert(actor, purpose, "Temp/image.PNG".into(), &extensions)
                    .unwrap();
                assert!(token.format.is_none());
                assert_eq!(token.file_name, "image.PNG");
                if expired {
                    time.fetch_add(600_000, Ordering::SeqCst);
                }
                let result = store.take(&token.token, owner, requested, None);
                if owner == actor && requested == purpose && !expired {
                    assert!(result.unwrap().format.is_none());
                } else {
                    assert_eq!(result.err().unwrap().code(), FILE_TOKEN_INVALID);
                }
                assert_eq!(
                    store
                        .take(&token.token, actor, purpose, None)
                        .err()
                        .unwrap()
                        .code(),
                    FILE_TOKEN_INVALID
                );
            }
            assert_eq!(
                store
                    .insert(actor, purpose, "Temp/image.exe".into(), &extensions)
                    .err()
                    .unwrap()
                    .code(),
                tenon_framework::file::TYPE_NOT_ALLOWED
            );
            for extensions in [
                None,
                Some(vec![]),
                Some(vec!["PNG".into()]),
                Some(vec![".png".into()]),
            ] {
                let input = FilePickInput {
                    purpose,
                    extensions,
                    format: None,
                    suggested_name: None,
                };
                assert_eq!(filters(&input).unwrap_err().code(), INPUT_INVALID);
            }
            let input = FilePickInput {
                purpose,
                extensions: Some(extensions.clone()),
                format: None,
                suggested_name: Some("image.png".into()),
            };
            assert_eq!(filters(&input).unwrap(), extensions);
        }
        let input: FilePickInput =
            serde_json::from_str(r#"{"purpose":"save","extensions":["png","jpg"]}"#).unwrap();
        assert_eq!(filters(&input).unwrap_err().code(), INPUT_INVALID);
        let input: FilePickInput =
            serde_json::from_str(r#"{"purpose":"store","extensions":["png","jpg"]}"#).unwrap();
        assert_eq!(filters(&input).unwrap(), vec!["png", "jpg"]);
        let input: FilePickInput = serde_json::from_str(r#"{"purpose":"import"}"#).unwrap();
        assert_eq!(filters(&input).unwrap(), vec!["xlsx", "csv", "json"]);
        let input: FilePickInput =
            serde_json::from_str(r#"{"purpose":"export","format":"csv"}"#).unwrap();
        assert_eq!(filters(&input).unwrap(), vec!["csv"]);
    }
    #[test]
    fn tokens_are_single_use_expiring_bound_to_actor_purpose_and_extension() {
        let time = Arc::new(AtomicI64::new(1_000_000));
        let clock = time.clone();
        let store = PickedFileStore::new(move || {
            Timestamp::from_millis(clock.load(Ordering::SeqCst)).unwrap()
        });
        let actor = Actor::User(Id::new());
        let token = store
            .insert(actor, FilePurpose::Export, "Temp/selection.csv".into(), &[])
            .unwrap();
        assert_eq!(token.file_name, "selection.csv");
        assert_eq!(token.format, Some(ExchangeFormat::Csv));
        assert!(
            store
                .take(
                    &token.token,
                    actor,
                    FilePurpose::Export,
                    Some(ExchangeFormat::Csv)
                )
                .is_ok()
        );
        assert_eq!(
            store
                .take(&token.token, actor, FilePurpose::Export, None)
                .err()
                .unwrap()
                .code(),
            FILE_TOKEN_INVALID
        );
        for (owner, purpose, format, expected) in [
            (
                Actor::User(Id::new()),
                FilePurpose::Export,
                None,
                FILE_TOKEN_INVALID,
            ),
            (actor, FilePurpose::Import, None, FILE_TOKEN_INVALID),
            (
                actor,
                FilePurpose::Export,
                Some(ExchangeFormat::Json),
                FORMAT_MISMATCH,
            ),
        ] {
            let token = store
                .insert(actor, FilePurpose::Export, "Temp/selection.csv".into(), &[])
                .unwrap();
            assert_eq!(
                store
                    .take(&token.token, owner, purpose, format)
                    .err()
                    .unwrap()
                    .code(),
                expected
            );
        }
        let token = store
            .insert(
                actor,
                FilePurpose::Import,
                "Temp/selection.XLSX".into(),
                &[],
            )
            .unwrap();
        time.fetch_add(600_000, Ordering::SeqCst);
        assert_eq!(
            store
                .take(&token.token, actor, FilePurpose::Import, None)
                .err()
                .unwrap()
                .code(),
            FILE_TOKEN_INVALID
        );
        assert_eq!(
            store
                .insert(actor, FilePurpose::Import, "Temp/selection.exe".into(), &[])
                .err()
                .unwrap()
                .code(),
            FORMAT_MISMATCH
        );
    }
}
