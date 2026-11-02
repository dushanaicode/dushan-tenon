//! 通用错误码、内部错误与 IPC 错误数据；错误码严格为三段，不依赖其他内核模块。

use std::{collections::BTreeMap, error::Error, fmt};

use serde::Serialize;
use ts_rs::TS;

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub struct ErrorCode(&'static str);

impl ErrorCode {
    pub const fn new(value: &'static str) -> Self {
        assert!(is_valid_code(value), "错误码须为三段小写代码");
        Self(value)
    }

    pub const fn as_str(self) -> &'static str {
        self.0
    }
}

impl fmt::Display for ErrorCode {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(self.0)
    }
}

pub(crate) const fn is_valid_code(value: &str) -> bool {
    let bytes = value.as_bytes();
    let mut index = 0;
    let mut separators = 0;
    let mut segment_length = 0;
    while index < bytes.len() {
        match bytes[index] {
            b'.' => {
                if segment_length == 0 {
                    return false;
                }
                separators += 1;
                segment_length = 0;
            }
            b'a'..=b'z' | b'0'..=b'9' | b'_' => segment_length += 1,
            _ => return false,
        }
        index += 1;
    }
    separators == 2 && segment_length > 0
}

pub const INTERNAL_UNEXPECTED: ErrorCode = ErrorCode::new("app.internal.unexpected");
pub const INPUT_INVALID: ErrorCode = ErrorCode::new("app.input.invalid");
pub const DATA_NOT_FOUND: ErrorCode = ErrorCode::new("app.data.not_found");
pub const DATA_VERSION_CONFLICT: ErrorCode = ErrorCode::new("app.data.version_conflict");
pub const PERMISSION_DENIED: ErrorCode = ErrorCode::new("app.permission.denied");
pub const JOB_CANCELLED: ErrorCode = ErrorCode::new("app.job.cancelled");

#[derive(Debug, thiserror::Error)]
#[error("{code}")]
pub struct AppError {
    pub(crate) code: ErrorCode,
    pub(crate) params: BTreeMap<&'static str, String>,
    #[source]
    pub(crate) source: Option<Box<dyn Error + Send + Sync>>,
}

impl AppError {
    pub fn code(&self) -> ErrorCode {
        self.code
    }

    pub fn new(code: ErrorCode) -> Self {
        Self {
            code,
            params: BTreeMap::new(),
            source: None,
        }
    }

    pub fn with_param(mut self, key: &'static str, value: impl Into<String>) -> Self {
        self.params.insert(key, value.into());
        self
    }

    pub fn with_source(mut self, source: impl Error + Send + Sync + 'static) -> Self {
        self.source = Some(Box::new(source));
        self
    }
}

#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct IpcError {
    pub code: String,
    #[ts(type = "Record<string, string>")]
    pub params: BTreeMap<String, String>,
    pub trace_id: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    const VALID: ErrorCode = ErrorCode::new("app.input.invalid_2");

    #[test]
    fn error_code_accepts_three_nonempty_lowercase_segments() {
        assert_eq!(VALID.as_str(), "app.input.invalid_2");
        for code in ["a.b.c", "123._.z9", "module_name.domain.error_name"] {
            assert!(is_valid_code(code), "{code}");
        }
    }

    #[test]
    fn error_code_rejects_invalid_formats() {
        for code in [
            "",
            "a",
            "a.b",
            "exchange.invalid",
            "file.invalid",
            "a.b.c.d",
            ".a.b",
            "a..b",
            "a.b.",
            "A.b.c",
            "a.b.c-d",
            "a.b.中",
            "a.b.c ",
        ] {
            assert!(!is_valid_code(code), "{code}");
        }
    }
}
