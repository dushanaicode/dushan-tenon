use crate::{id::Id, time::Timestamp};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;
use ts_rs::TS;

crate::dict_enum! {
    pub enum JobStatus {
        Queued => "queued" (Info),
        Running => "running" (Info),
        Succeeded => "succeeded" (Success),
        Failed => "failed" (Danger),
        Cancelled => "cancelled" (Neutral),
        NeedsReview => "needs_review" (Warning),
    }
}

impl JobStatus {
    pub fn is_terminal(self) -> bool {
        !matches!(self, Self::Queued | Self::Running)
    }
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct JobProgress {
    #[ts(type = "number | null")]
    pub current: Option<i64>,
    #[ts(type = "number | null")]
    pub total: Option<i64>,
    pub message_key: Option<String>,
    #[ts(type = "Record<string, string>")]
    pub params: BTreeMap<String, String>,
}

#[derive(Clone, Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct JobSnapshot {
    pub id: Id,
    pub kind: String,
    pub module: String,
    #[ts(type = "unknown")]
    pub payload: Value,
    pub priority: i32,
    pub status: JobStatus,
    pub attempts: i32,
    pub max_attempts: i32,
    pub retry_safe: bool,
    pub run_after: Timestamp,
    pub progress: JobProgress,
    #[ts(type = "unknown | null")]
    pub result: Option<Value>,
    pub error_code: Option<String>,
    #[ts(type = "Record<string, string>")]
    pub error_params: BTreeMap<String, String>,
    pub cancel_requested: bool,
    pub submitted_by: Option<Id>,
    pub created_at: Timestamp,
    pub updated_at: Timestamp,
    pub started_at: Option<Timestamp>,
    pub finished_at: Option<Timestamp>,
    #[ts(type = "number")]
    pub row_version: i64,
}

#[derive(Clone, Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct JobEvent {
    pub job_id: Id,
    pub status: JobStatus,
    pub progress: JobProgress,
    pub attempts: i32,
    #[ts(type = "number")]
    pub row_version: i64,
}

impl JobSnapshot {
    pub fn event(&self) -> JobEvent {
        JobEvent {
            job_id: self.id,
            status: self.status,
            progress: self.progress.clone(),
            attempts: self.attempts,
            row_version: self.row_version,
        }
    }
}

pub struct SubmitJob {
    pub kind: String,
    pub payload: Value,
    pub priority: i32,
    pub run_after: Option<Timestamp>,
    pub submitted_by: Option<Id>,
}

#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct JobSubmitted {
    pub job_id: Id,
}

#[derive(Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct JobId {
    pub id: Id,
}

impl JobProgress {
    pub(super) fn new(
        current: i64,
        total: i64,
        message_key: &str,
        params: BTreeMap<String, String>,
    ) -> Result<Self, crate::error::AppError> {
        if current < 0 || total < current || message_key.is_empty() || message_key.len() > 128 {
            return Err(crate::error::AppError::new(
                crate::error::INTERNAL_UNEXPECTED,
            ));
        }
        Ok(Self {
            current: Some(current),
            total: Some(total),
            message_key: Some(message_key.into()),
            params,
        })
    }
}

pub(super) enum TerminalJob {
    Succeeded,
    Failed { code: String },
    Cancelled,
    NeedsReview,
}

pub(super) struct StoredJob {
    pub(super) snapshot: JobSnapshot,
    pub(super) terminal: Option<TerminalJob>,
}

#[derive(Clone)]
pub(super) struct LeasedJob {
    pub(super) snapshot: JobSnapshot,
    pub(super) started_at: Timestamp,
    pub(super) owner: String,
}
