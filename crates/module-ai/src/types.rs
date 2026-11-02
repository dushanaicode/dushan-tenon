use serde::{Deserialize, Serialize};
use tenon_framework::id::Id;
use ts_rs::TS;

#[derive(Clone, Copy, PartialEq, Eq, Deserialize, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub enum AiRole {
    System,
    User,
    Assistant,
}

#[derive(Clone, Copy, PartialEq, Eq, Deserialize, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub enum AiPartKind {
    Text,
    Reasoning,
}

#[derive(Clone, Serialize, TS)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum AiPart {
    Text { part_id: Id, text: String },
    Reasoning { part_id: Id, text: String },
}

impl<'de> Deserialize<'de> for AiPart {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        // ts-rs 12 不识别 enum 的 deny_unknown_fields；私有输入保留严格校验，
        // 不给生成器隐藏警告或加入第二份公开 DTO。
        #[derive(Deserialize)]
        #[serde(
            tag = "type",
            rename_all = "camelCase",
            rename_all_fields = "camelCase",
            deny_unknown_fields
        )]
        enum Input {
            Text { part_id: Id, text: String },
            Reasoning { part_id: Id, text: String },
        }
        Ok(match Input::deserialize(deserializer)? {
            Input::Text { part_id, text } => Self::Text { part_id, text },
            Input::Reasoning { part_id, text } => Self::Reasoning { part_id, text },
        })
    }
}

#[derive(Clone, Deserialize, Serialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AiMessage {
    pub id: Id,
    pub role: AiRole,
    pub parts: Vec<AiPart>,
}

#[derive(Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AiChatInput {
    pub run_id: Id,
    pub messages: Vec<AiMessage>,
}

#[derive(Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AiCancelInput {
    pub run_id: Id,
}

#[derive(Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub enum AiFinishReason {
    Stop,
    Length,
}

#[derive(Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct AiUsage {
    #[ts(type = "number | null")]
    pub input: Option<u64>,
    #[ts(type = "number | null")]
    pub output: Option<u64>,
    #[ts(type = "number | null")]
    pub total_tokens: Option<u64>,
    #[ts(type = "number | null")]
    pub reasoning: Option<u64>,
    #[ts(type = "number | null")]
    pub cache_read: Option<u64>,
}

#[derive(Clone, Serialize, TS)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum AiUpdate {
    MessageStart {
        model: String,
        trace_id: String,
        total_timeout_ms: u32,
    },
    PartStart {
        part_id: Id,
        kind: AiPartKind,
    },
    TextDelta {
        part_id: Id,
        text: String,
    },
    ReasoningDelta {
        part_id: Id,
        text: String,
    },
    PartEnd {
        part_id: Id,
    },
    Usage {
        usage: AiUsage,
    },
    Finish {
        finish_reason: AiFinishReason,
        usage: Option<AiUsage>,
    },
}

#[derive(Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct AiStreamData {
    pub run_id: Id,
    pub message_id: Id,
    pub update: AiUpdate,
}

#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct AiConnectionTest {
    pub model: String,
    pub duration_ms: u32,
    pub usage: Option<AiUsage>,
}
