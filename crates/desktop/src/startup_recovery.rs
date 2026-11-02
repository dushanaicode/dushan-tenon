//! 有界原子启动记录与提示、重试策略；对话框、事件循环和进程重启由宿主负责。
use serde::{Deserialize, Serialize};
use std::{
    error::Error,
    ffi::OsString,
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
};
use tenon_framework::{
    backup,
    error::{AppError, ErrorCode, is_valid_code},
};

const RECORD_LIMIT: u64 = 4096;
const RECORD_INVALID: ErrorCode = ErrorCode::new("app.recovery.record_invalid");
const RECORD_UNAVAILABLE: ErrorCode = ErrorCode::new("app.recovery.record_unavailable");

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RecoveryNotice {
    code: String,
    trace_id: String,
}
impl RecoveryNotice {
    fn new(code: &str) -> Self {
        Self {
            code: code.into(),
            trace_id: uuid::Uuid::now_v7().to_string(),
        }
    }
    fn validate(&self) -> bool {
        self.code.len() <= 128 && is_valid_code(&self.code) && valid_trace(&self.trace_id)
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
enum Phase {
    Running,
    Clean,
    Failed,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RunRecord {
    schema_version: u8,
    run_id: String,
    phase: Phase,
    #[serde(with = "Option")]
    last_issue: Option<RecoveryNotice>,
}
fn valid_trace(trace: &str) -> bool {
    uuid::Uuid::parse_str(trace).is_ok_and(|id| id.hyphenated().to_string() == trace)
}

struct SessionRecord {
    path: PathBuf,
    scratch: PathBuf,
    current: RunRecord,
}
impl SessionRecord {
    fn begin(root: &Path, scratch: &Path) -> Result<(Self, Option<RecoveryNotice>), AppError> {
        let path = root.join("startup-state.json");
        backup::regular_path(&path, true).map_err(|_| AppError::new(RECORD_UNAVAILABLE))?;
        let previous = match fs::File::open(&path) {
            Ok(file) => {
                let mut bytes = Vec::new();
                file.take(RECORD_LIMIT + 1)
                    .read_to_end(&mut bytes)
                    .map_err(|_| AppError::new(RECORD_UNAVAILABLE))?;
                if bytes.len() as u64 > RECORD_LIMIT {
                    return Err(AppError::new(RECORD_INVALID));
                }
                let record: RunRecord =
                    serde_json::from_slice(&bytes).map_err(|_| AppError::new(RECORD_INVALID))?;
                if record.schema_version != 1
                    || !valid_trace(&record.run_id)
                    || record
                        .last_issue
                        .as_ref()
                        .is_some_and(|issue| !issue.validate())
                    || (record.phase == Phase::Failed && record.last_issue.is_none())
                {
                    return Err(AppError::new(RECORD_INVALID));
                }
                Some(record)
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
            Err(_) => return Err(AppError::new(RECORD_UNAVAILABLE)),
        };
        let notice = previous.as_ref().and_then(|record| match record.phase {
            Phase::Running => Some(RecoveryNotice {
                code: "app.lifecycle.unclean_exit".into(),
                trace_id: record.run_id.clone(),
            }),
            Phase::Failed => record.last_issue.clone(),
            Phase::Clean => None,
        });
        let session = Self {
            path,
            scratch: scratch.into(),
            current: RunRecord {
                schema_version: 1,
                run_id: uuid::Uuid::now_v7().to_string(),
                phase: Phase::Running,
                last_issue: notice
                    .clone()
                    .or_else(|| previous.and_then(|record| record.last_issue)),
            },
        };
        session.persist()?;
        Ok((session, notice))
    }
    fn persist(&self) -> Result<(), AppError> {
        crate::state_root::create_directory(&self.scratch)
            .map_err(|_| AppError::new(RECORD_UNAVAILABLE))?;
        backup::regular_path(&self.path, true).map_err(|_| AppError::new(RECORD_UNAVAILABLE))?;
        let bytes = serde_json::to_vec(&self.current).map_err(|_| AppError::new(RECORD_INVALID))?;
        if bytes.len() as u64 > RECORD_LIMIT {
            return Err(AppError::new(RECORD_INVALID));
        }
        // Only host-injected scratch. A different volume or read-only directory is reported.
        let mut temporary = tempfile::NamedTempFile::new_in(&self.scratch)
            .map_err(|_| AppError::new(RECORD_UNAVAILABLE))?;
        temporary
            .write_all(&bytes)
            .map_err(|_| AppError::new(RECORD_UNAVAILABLE))?;
        temporary
            .as_file()
            .sync_all()
            .map_err(|_| AppError::new(RECORD_UNAVAILABLE))?;
        temporary
            .persist(&self.path)
            .map_err(|_| AppError::new(RECORD_UNAVAILABLE))?
            .sync_all()
            .map_err(|_| AppError::new(RECORD_UNAVAILABLE))?;
        Ok(())
    }
    fn fail(&mut self, issue: RecoveryNotice) -> Result<(), AppError> {
        if !issue.validate() {
            return Err(AppError::new(RECORD_INVALID));
        }
        self.current.phase = Phase::Failed;
        self.current.last_issue = Some(issue);
        self.persist()
    }
    fn finish(&mut self) -> Result<(), AppError> {
        if self.current.phase == Phase::Running {
            self.current.phase = Phase::Clean;
            if let Err(error) = self.persist() {
                self.current.phase = Phase::Running;
                return Err(error);
            }
        }
        Ok(())
    }
}

/// 宿主串行调用记录操作；恢复事务成功后才 begin_record，关闭成功后才 finish_record。
#[derive(Default)]
pub struct StartupRecovery {
    record: Option<SessionRecord>,
    notice: Option<RecoveryNotice>,
}

impl StartupRecovery {
    /// 失败保留原文件并保存安全提示；宿主决定如何显示该错误。
    pub fn begin_record(&mut self, root: &Path, scratch: &Path) -> Result<(), AppError> {
        match SessionRecord::begin(root, scratch) {
            Ok((record, notice)) => {
                self.record = Some(record);
                self.notice = notice;
                Ok(())
            }
            Err(error) => {
                self.record = None;
                self.notice = Some(RecoveryNotice::new(error.code().as_str()));
                Err(error)
            }
        }
    }

    pub fn notice_json(&self) -> Result<String, AppError> {
        serde_json::to_string(&self.notice).map_err(|_| AppError::new(RECORD_INVALID))
    }

    pub fn finish_record(&mut self) -> Result<(), AppError> {
        if let Some(record) = &mut self.record {
            record.finish()?;
        }
        Ok(())
    }

    pub fn record_failure(&mut self, issue: RecoveryNotice) -> Result<(), AppError> {
        self.record
            .as_mut()
            .ok_or_else(|| AppError::new(RECORD_UNAVAILABLE))?
            .fail(issue)
    }

    pub fn startup_failed(&mut self) -> Result<(), AppError> {
        self.record_failure(RecoveryNotice::new("app.startup.failed"))
    }
}

pub fn retry_args(original: &[OsString], basic: bool) -> Vec<OsString> {
    let mut args: Vec<_> = original
        .iter()
        .filter(|arg| *arg != "--safe-mode")
        .cloned()
        .collect();
    if basic {
        args.push("--safe-mode".into());
    }
    args
}

/// 只提取安全 code；绝不格式化错误 source 或参数。
pub fn failure_notice(error: &(dyn Error + 'static)) -> RecoveryNotice {
    let code = error
        .downcast_ref::<AppError>()
        .map(|error| error.code().as_str())
        .unwrap_or("app.startup.failed");
    RecoveryNotice::new(code)
}

pub fn failure_summary(issue: &RecoveryNotice) -> Result<String, AppError> {
    if !issue.validate() {
        return Err(AppError::new(RECORD_INVALID));
    }
    Ok(format!(
        "应用启动失败 / Startup failed\nCode: {}\nTrace: {}\n\n可重试，或仅本次使用基础界面启动。不会重置数据或保存的外观设置。\nRetry, or use basic graphics for this launch. Saved data and preferences are unchanged.",
        issue.code, issue.trace_id
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    fn roots() -> (tempfile::TempDir, PathBuf) {
        let dir = tempfile::Builder::new()
            .prefix("startup-record-")
            .tempdir_in(std::env::var_os("TEMP").expect("isolated TEMP"))
            .unwrap();
        let scratch = dir.path().join("Temp/record");
        (dir, scratch)
    }
    #[test]
    fn retry_removes_basic_mode_and_keeps_other_arguments() {
        let original = vec![
            "--state-root".into(),
            "workspace/Temp/state".into(),
            "--safe-mode".into(),
            "--set".into(),
            "ui.theme=dark".into(),
        ];
        assert_eq!(
            retry_args(&original, false),
            vec![
                OsString::from("--state-root"),
                "workspace/Temp/state".into(),
                "--set".into(),
                "ui.theme=dark".into()
            ]
        );
        let basic = retry_args(&original, true);
        assert_eq!(basic.iter().filter(|arg| *arg == "--safe-mode").count(), 1);
        assert_eq!(retry_args(&basic, true), basic);
    }
    #[test]
    fn failure_summary_has_only_safe_code_and_trace() {
        let error = AppError::new(ErrorCode::new("app.startup.test"))
            .with_param("secret", "private/path")
            .with_source(std::io::Error::other("secret endpoint"));
        let issue = failure_notice(&error);
        let summary = failure_summary(&issue).unwrap();
        assert!(summary.contains("app.startup.test"));
        assert!(valid_trace(&issue.trace_id));
        assert!(!summary.contains("private/path"));
        assert!(!summary.contains("secret endpoint"));
    }
    #[test]
    fn unclean_exit_notices_once_and_keeps_last_issue_after_clean_exit() {
        let (root, scratch) = roots();
        let (first, previous) = SessionRecord::begin(root.path(), &scratch).unwrap();
        assert!(previous.is_none());
        let old_id = first.current.run_id.clone();
        drop(first);
        let (mut second, previous) = SessionRecord::begin(root.path(), &scratch).unwrap();
        assert_eq!(previous.unwrap().trace_id, old_id);
        assert_eq!(
            second.current.last_issue.as_ref().unwrap().code,
            "app.lifecycle.unclean_exit"
        );
        second.finish().unwrap();
        drop(second);
        let (third, previous) = SessionRecord::begin(root.path(), &scratch).unwrap();
        assert!(previous.is_none());
        assert!(third.current.last_issue.is_some());
    }
    #[test]
    fn failed_startup_keeps_its_code_even_when_event_loop_exits() {
        let (root, scratch) = roots();
        let (mut record, _) = SessionRecord::begin(root.path(), &scratch).unwrap();
        record
            .fail(RecoveryNotice::new("app.startup.test"))
            .unwrap();
        record.finish().unwrap();
        let (_, notice) = SessionRecord::begin(root.path(), &scratch).unwrap();
        assert_eq!(notice.unwrap().code, "app.startup.test");
        let text = fs::read_to_string(root.path().join("startup-state.json")).unwrap();
        assert!(!text.contains(root.path().to_str().unwrap()));
        assert!(text.len() < RECORD_LIMIT as usize);
    }
    #[test]
    fn corrupt_or_oversized_records_are_preserved_and_reported() {
        let (root, scratch) = roots();
        let path = root.path().join("startup-state.json");
        for bytes in [b"broken".to_vec(), vec![b' '; RECORD_LIMIT as usize + 1]] {
            fs::write(&path, &bytes).unwrap();
            let mut recovery = StartupRecovery::default();
            let _ = recovery.begin_record(root.path(), &scratch);
            assert!(
                recovery
                    .notice_json()
                    .unwrap()
                    .contains("app.recovery.record_invalid")
            );
            recovery.finish_record().unwrap();
            assert_eq!(fs::read(&path).unwrap(), bytes);
        }
    }
    #[test]
    fn unavailable_scratch_does_not_replace_previous_evidence() {
        let (root, scratch) = roots();
        let (mut record, _) = SessionRecord::begin(root.path(), &scratch).unwrap();
        record.finish().unwrap();
        let before = fs::read(root.path().join("startup-state.json")).unwrap();
        let blocked = root.path().join("not-a-directory");
        fs::write(&blocked, b"blocked").unwrap();
        let mut recovery = StartupRecovery::default();
        assert!(recovery.begin_record(root.path(), &blocked).is_err());
        assert!(
            recovery
                .notice_json()
                .unwrap()
                .contains("app.recovery.record_unavailable")
        );
        assert_eq!(
            fs::read(root.path().join("startup-state.json")).unwrap(),
            before
        );
    }

    #[test]
    fn failed_main_window_is_not_marked_clean_by_completed_shutdown() {
        let (root, scratch) = roots();
        let mut recovery = StartupRecovery::default();
        let _ = recovery.begin_record(root.path(), &scratch);
        recovery.startup_failed().unwrap();
        recovery.finish_record().unwrap();
        let (_, notice) = SessionRecord::begin(root.path(), &scratch).unwrap();
        assert_eq!(notice.unwrap().code, "app.startup.failed");
    }

    #[test]
    fn invalid_notice_fields_are_never_replayed_into_the_page() {
        let (root, scratch) = roots();
        let path = root.path().join("startup-state.json");
        let content = serde_json::json!({
            "schemaVersion": 1,
            "runId": uuid::Uuid::now_v7().to_string(),
            "phase": "failed",
            "lastIssue": { "code": "private/path", "traceId": uuid::Uuid::now_v7().to_string() }
        });
        let original = serde_json::to_vec(&content).unwrap();
        fs::write(&path, &original).unwrap();
        let mut recovery = StartupRecovery::default();
        let _ = recovery.begin_record(root.path(), &scratch);
        assert!(!recovery.notice_json().unwrap().contains("private/path"));
        assert!(
            recovery
                .notice_json()
                .unwrap()
                .contains("app.recovery.record_invalid")
        );
        assert_eq!(fs::read(&path).unwrap(), original);
    }

    #[test]
    fn record_contains_only_version_phase_safe_codes_and_uuids() {
        let (root, scratch) = roots();
        let mut recovery = StartupRecovery::default();
        recovery.begin_record(root.path(), &scratch).unwrap();
        recovery.startup_failed().unwrap();
        let path = root.path().join("startup-state.json");
        let value: serde_json::Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        assert_eq!(
            value
                .as_object()
                .unwrap()
                .keys()
                .map(String::as_str)
                .collect::<Vec<_>>(),
            ["lastIssue", "phase", "runId", "schemaVersion"]
        );
        assert!(valid_trace(value["runId"].as_str().unwrap()));
        assert!(valid_trace(value["lastIssue"]["traceId"].as_str().unwrap()));
        for code in [
            "a..c",
            "app.startup",
            "app.startup.failed.extra",
            "private/path",
            "app.startup.Failed",
        ] {
            let mut invalid = value.clone();
            invalid["lastIssue"]["code"] = code.into();
            let bytes = serde_json::to_vec(&invalid).unwrap();
            fs::write(&path, &bytes).unwrap();
            let mut recovery = StartupRecovery::default();
            assert_eq!(
                recovery
                    .begin_record(root.path(), &scratch)
                    .unwrap_err()
                    .code(),
                RECORD_INVALID
            );
            recovery.finish_record().unwrap();
            assert_eq!(fs::read(&path).unwrap(), bytes);
        }
    }

    #[test]
    fn failed_clean_write_can_be_retried_without_losing_running_record() {
        let (root, scratch) = roots();
        let (mut record, _) = SessionRecord::begin(root.path(), &scratch).unwrap();
        let before = fs::read(&record.path).unwrap();
        let saved = scratch.with_file_name("record-saved");
        fs::rename(&scratch, &saved).unwrap();
        fs::write(&scratch, b"blocked").unwrap();
        assert_eq!(record.finish().unwrap_err().code(), RECORD_UNAVAILABLE);
        assert_eq!(record.current.phase, Phase::Running);
        assert_eq!(fs::read(&record.path).unwrap(), before);
        fs::remove_file(&scratch).unwrap();
        fs::rename(saved, &scratch).unwrap();
        record.finish().unwrap();
        let (_, notice) = SessionRecord::begin(root.path(), &scratch).unwrap();
        assert!(notice.is_none());
    }
}
