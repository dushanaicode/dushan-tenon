//! 无状态的单服务 Chat Completions 流；不保存消息或发起自动重试。
mod client;
mod service;
mod sse;
mod types;

pub use service::AiService;
pub use types::*;

use tenon_framework::{
    error::ErrorCode,
    module::ModuleDeclaration,
    param::{ParamDeclaration, ParamEffect, ParamKind},
};

pub const NOT_CONFIGURED: ErrorCode = ErrorCode::new("ai.service.not_configured");
pub const INVALID_CONFIG: ErrorCode = ErrorCode::new("ai.service.invalid");
pub const BUSY: ErrorCode = ErrorCode::new("ai.stream.busy");
pub const CONFLICT: ErrorCode = ErrorCode::new("ai.stream.conflict");
pub const CONNECT_FAILED: ErrorCode = ErrorCode::new("ai.http.connect_failed");
pub const AUTH_FAILED: ErrorCode = ErrorCode::new("ai.http.auth_failed");
pub const RATE_LIMITED: ErrorCode = ErrorCode::new("ai.http.rate_limited");
pub const UNAVAILABLE: ErrorCode = ErrorCode::new("ai.http.unavailable");
pub const HTTP_REJECTED: ErrorCode = ErrorCode::new("ai.http.rejected");
pub const REDIRECT_REJECTED: ErrorCode = ErrorCode::new("ai.http.redirect");
pub const TIMEOUT: ErrorCode = ErrorCode::new("ai.http.timeout");
pub const PROTOCOL: ErrorCode = ErrorCode::new("ai.stream.protocol");
pub const LIMIT: ErrorCode = ErrorCode::new("ai.stream.limit");
pub const RESPONSE_REJECTED: ErrorCode = ErrorCode::new("ai.response.rejected");
pub const FILTERED: ErrorCode = ErrorCode::new("ai.response.filtered");
pub const UNSUPPORTED: ErrorCode = ErrorCode::new("ai.response.unsupported");
pub const CANCELLED: ErrorCode = ErrorCode::new("ai.stream.cancelled");
pub const RESULT_UNKNOWN: ErrorCode = ErrorCode::new("ai.stream.result_unknown");
pub const SHUTDOWN_TIMEOUT: ErrorCode = ErrorCode::new("ai.stream.shutdown_timeout");
pub const SEQUENCE_GAP: ErrorCode = ErrorCode::new("ai.stream.sequence_gap");
pub const CANCEL_UNCONFIRMED: ErrorCode = ErrorCode::new("ai.stream.cancel_unconfirmed");

pub const ERROR_CODES: &[ErrorCode] = &[
    NOT_CONFIGURED,
    INVALID_CONFIG,
    BUSY,
    CONFLICT,
    CONNECT_FAILED,
    AUTH_FAILED,
    RATE_LIMITED,
    UNAVAILABLE,
    HTTP_REJECTED,
    REDIRECT_REJECTED,
    TIMEOUT,
    PROTOCOL,
    LIMIT,
    RESPONSE_REJECTED,
    FILTERED,
    UNSUPPORTED,
    CANCELLED,
    RESULT_UNKNOWN,
    SHUTDOWN_TIMEOUT,
    SEQUENCE_GAP,
    CANCEL_UNCONFIRMED,
];

const fn param(
    key: &'static str,
    kind: ParamKind,
    default: &'static str,
    order: i32,
) -> ParamDeclaration {
    ParamDeclaration {
        key,
        kind,
        default,
        group: "ai.service",
        order,
        read_permission: Some("ai.service.manage"),
        write_permission: Some("ai.service.manage"),
        effect: ParamEffect::NextRead,
    }
}

const BASE_URL_PARAM: ParamDeclaration =
    param("ai.base_url", ParamKind::Text { max_chars: 1024 }, "", 10);

pub const DECLARATION: ModuleDeclaration = ModuleDeclaration {
    id: "ai",
    version: env!("CARGO_PKG_VERSION"),
    dependencies: &["account"],
    required_capabilities: &[],
    core: false,
    migrations: &[],
    error_codes: ERROR_CODES,
    permissions: &["ai.chat.use", "ai.service.manage"],
    dictionaries: &[],
    params: &[
        BASE_URL_PARAM,
        param("ai.model", ParamKind::Text { max_chars: 128 }, "", 20),
        param("ai.api_key", ParamKind::Secret, "", 30),
        param(
            "ai.connect_timeout_seconds",
            ParamKind::Integer { min: 1, max: 60 },
            "10",
            40,
        ),
        param(
            "ai.idle_timeout_seconds",
            ParamKind::Integer { min: 1, max: 300 },
            "30",
            50,
        ),
        param(
            "ai.total_timeout_seconds",
            ParamKind::Integer { min: 5, max: 1800 },
            "300",
            60,
        ),
        param("ai.include_usage", ParamKind::Boolean, "true", 70),
    ],
    file_purposes: &[],
    job_kinds: &[],
    schedules: &[],
    message_keys: &[
        "ai.stream.missingDone",
        "ai.stream.missingFinish",
        "ai.stream.interrupted",
        "ai.stream.timeout",
    ],
};

const MAX_ACTIVE_REQUESTS: usize = 2;
/// 单次聊天请求的消息数量上限。
pub const MAX_MESSAGES: usize = 128;
/// 单条消息的内容分片数量上限。
pub const MAX_PARTS_PER_MESSAGE: usize = 64;
/// 单次聊天请求的文本及序列化请求体字节数上限。
pub const MAX_REQUEST_BYTES: usize = 1_048_576;
const MAX_RESPONSE_BYTES: usize = 8_388_608;
const MAX_SSE_EVENT_BYTES: usize = 262_144;
const MAX_SSE_LINE_BYTES: usize = 262_144;
const MAX_STREAM_DELTAS: usize = 4096;
const COALESCE_BYTES: usize = 16_384;
const COALESCE_MS: u64 = 32;
const PREPARE_TIMEOUT_SECONDS: u64 = 15;
const TEST_TIMEOUT_SECONDS: u64 = 15;
const SHUTDOWN_TIMEOUT_SECONDS: u64 = 5;

#[cfg(test)]
mod test_support;
