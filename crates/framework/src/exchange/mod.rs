//! 有界的数据交换合同；业务校验与事务写入由数据集提供。
mod csv;
mod json;
pub mod run;
mod xlsx;

use crate::{
    dict::DictDeclaration,
    error::{AppError, ErrorCode, INPUT_INVALID},
    i18n::{Language, Translator},
};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::{
    collections::{BTreeMap, BTreeSet},
    path::{Path, PathBuf},
};
use ts_rs::TS;

crate::dict_enum! {
    pub enum ExchangeFormat {
        Xlsx => "xlsx" (Success),
        Csv => "csv" (Info),
        Json => "json" (Neutral),
    }
}
impl ExchangeFormat {
    pub const fn extension(self) -> &'static str {
        self.as_str()
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize, Serialize, TS)]
#[serde(rename_all = "lowercase")]
pub enum ImportMode {
    Error,
    Skip,
    Upsert,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ColumnKind {
    Text { max_chars: usize },
    Integer,
    Boolean,
    Timestamp,
    List { max_items: usize },
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ImportColumn {
    Required,
    Optional,
    Ignored,
}
#[derive(Clone, Copy, Debug)]
pub struct ExchangeColumn {
    pub key: &'static str,
    pub label_key: &'static str,
    pub kind: ColumnKind,
    pub import: ImportColumn,
    pub dict: Option<&'static str>,
}
#[derive(Clone, Copy, Debug)]
pub struct ExchangeLimits {
    pub file_bytes: usize,
    pub import_rows: usize,
    pub export_rows: usize,
    pub cell_chars: usize,
    pub report_errors: usize,
}
impl Default for ExchangeLimits {
    fn default() -> Self {
        Self {
            file_bytes: 10 * 1024 * 1024,
            import_rows: 10_000,
            export_rows: 100_000,
            cell_chars: 4096,
            report_errors: 200,
        }
    }
}

pub struct ExchangeDataset {
    pub code: &'static str,
    pub columns: &'static [ExchangeColumn],
    pub modes: &'static [ImportMode],
    pub limits: ExchangeLimits,
}
pub type ExchangeRow = BTreeMap<String, Value>;

#[derive(Clone, Debug, Deserialize, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct RowError {
    pub row: u32,
    pub column: Option<String>,
    pub code: String,
    #[ts(type = "Record<string, string>")]
    pub params: BTreeMap<String, String>,
}
impl RowError {
    fn new(row: u32, column: Option<&str>, error: AppError) -> Self {
        Self {
            row,
            column: column.map(str::to_owned),
            code: error.code().as_str().into(),
            params: error
                .params
                .into_iter()
                .map(|(key, value)| (key.into(), value))
                .collect(),
        }
    }
}
#[derive(Clone, Debug, Default, Deserialize, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct ImportReport {
    pub total: u32,
    pub created: u32,
    pub updated: u32,
    pub skipped: u32,
    pub errors: Vec<RowError>,
    pub errors_truncated: bool,
}
impl ImportReport {
    fn error(&mut self, error: RowError, limits: ExchangeLimits) {
        if self.errors.len() < limits.report_errors {
            self.errors.push(error);
        } else {
            self.errors_truncated = true;
        }
    }
}

pub trait DictResolver: Send + Sync {
    fn label(&self, code: &str, value: &str, language: Language) -> Result<String, AppError>;
    fn value(&self, code: &str, value_or_label: &str) -> Result<Option<String>, AppError>;
    fn labels(&self, code: &str, language: Language) -> Result<Vec<String>, AppError>;
}

pub const HEADER_INVALID: ErrorCode = ErrorCode::new("app.exchange.header_invalid");
pub const DICT_VALUE_UNKNOWN: ErrorCode = ErrorCode::new("app.exchange.dict_value_unknown");
pub const ENCODING_INVALID: ErrorCode = ErrorCode::new("app.exchange.encoding_invalid");
pub const DATASET_MISMATCH: ErrorCode = ErrorCode::new("app.exchange.dataset_mismatch");
pub const FILE_TOO_LARGE: ErrorCode = ErrorCode::new("app.exchange.file_too_large");
pub const TOO_MANY_ROWS: ErrorCode = ErrorCode::new("app.exchange.too_many_rows");
pub const CELL_TOO_LONG: ErrorCode = ErrorCode::new("app.exchange.cell_too_long");
pub const ROWS_INVALID: ErrorCode = ErrorCode::new("app.exchange.rows_invalid");
pub const DUPLICATE_IN_FILE: ErrorCode = ErrorCode::new("app.exchange.duplicate_in_file");
pub const CONFLICT: ErrorCode = ErrorCode::new("app.exchange.conflict");
pub const FORMAT_MISMATCH: ErrorCode = ErrorCode::new("app.exchange.format_mismatch");

pub const DICTIONARIES: &[DictDeclaration] = &[DictDeclaration {
    code: "framework.exchange_format",
    items: ExchangeFormat::ITEMS,
}];

pub struct Exchange<'a> {
    pub dataset: &'a ExchangeDataset,
    pub format: ExchangeFormat,
    pub language: Language,
    pub translator: &'a dyn Translator,
    pub dictionaries: &'a dyn DictResolver,
}

fn invalid(path: &str) -> AppError {
    AppError::new(INPUT_INVALID).with_param("path", path)
}
fn header_invalid(column: &str) -> AppError {
    AppError::new(HEADER_INVALID).with_param("column", column)
}
fn too_many(max: usize) -> AppError {
    AppError::new(TOO_MANY_ROWS).with_param("max", max.to_string())
}

impl Exchange<'_> {
    fn headers(&self) -> Result<Vec<String>, AppError> {
        self.dataset
            .columns
            .iter()
            .map(|column| {
                self.translator
                    .text_in(self.language, column.label_key, &Map::new())
            })
            .collect()
    }

    fn match_headers(&self, headers: &[String]) -> Result<Vec<&ExchangeColumn>, AppError> {
        let mut matched = Vec::new();
        let mut seen = BTreeSet::new();
        for header in headers {
            let candidate = header.trim().to_lowercase();
            let mut found = None;
            for column in self.dataset.columns {
                let mut labels = vec![column.key.to_owned()];
                for language in [Language::ZhCn, Language::EnUs] {
                    labels.push(self.translator.text_in(
                        language,
                        column.label_key,
                        &Map::new(),
                    )?);
                }
                if labels
                    .iter()
                    .any(|label| label.trim().to_lowercase() == candidate)
                {
                    if found.is_some() {
                        return Err(header_invalid(header));
                    }
                    found = Some(column);
                }
            }
            let column = found.ok_or_else(|| header_invalid(header))?;
            if !seen.insert(column.key) {
                return Err(header_invalid(header));
            }
            matched.push(column);
        }
        self.required_headers(&seen)?;
        Ok(matched)
    }

    fn required_headers(&self, keys: &BTreeSet<&str>) -> Result<(), AppError> {
        for column in self.dataset.columns {
            if column.import == ImportColumn::Required && !keys.contains(column.key) {
                return Err(header_invalid(column.key));
            }
        }
        Ok(())
    }

    pub fn read(&self, bytes: &[u8]) -> Result<Vec<(u32, ExchangeRow)>, AppError> {
        if bytes.len() > self.dataset.limits.file_bytes {
            return Err(AppError::new(FILE_TOO_LARGE));
        }
        match self.format {
            ExchangeFormat::Csv => csv::read(self, bytes),
            ExchangeFormat::Xlsx => xlsx::read(self, bytes),
            ExchangeFormat::Json => json::read(self, bytes),
        }
    }

    fn normalize(&self, row: u32, values: ExchangeRow) -> (ExchangeRow, Vec<RowError>) {
        let mut result = ExchangeRow::new();
        let mut errors = Vec::new();
        for column in self.dataset.columns {
            let value = values.get(column.key).cloned().unwrap_or(Value::Null);
            let value = self.cell(column, value);
            match value {
                Ok(value) if column.import != ImportColumn::Ignored => {
                    result.insert(column.key.into(), value);
                }
                Ok(_) => {}
                Err(error) => errors.push(RowError::new(row, Some(column.key), error)),
            }
        }
        (result, errors)
    }

    fn cell(&self, column: &ExchangeColumn, value: Value) -> Result<Value, AppError> {
        let length = match &value {
            Value::String(value) => value.chars().count(),
            Value::Array(items) => items
                .iter()
                .map(|item| item.as_str().map_or(0, |item| item.chars().count()))
                .sum(),
            _ => 0,
        };
        let max = match column.kind {
            ColumnKind::Text { max_chars } => max_chars.min(self.dataset.limits.cell_chars),
            _ => self.dataset.limits.cell_chars,
        };
        if length > max {
            return Err(AppError::new(CELL_TOO_LONG).with_param("max", max.to_string()));
        }
        if column.import == ImportColumn::Ignored {
            return Ok(Value::Null);
        }
        if value.is_null() || value.as_str() == Some("") {
            return if column.import == ImportColumn::Required {
                Err(invalid(column.key))
            } else {
                Ok(Value::Null)
            };
        }
        let human = self.format != ExchangeFormat::Json;
        if let Some(code) = column.dict {
            let text = value.as_str().ok_or_else(|| invalid(column.key))?;
            let resolved = self
                .dictionaries
                .value(code, text)?
                .ok_or_else(|| AppError::new(DICT_VALUE_UNKNOWN))?;
            // JSON 使用原始值，不接受翻译标签。
            if !human && resolved != text {
                return Err(AppError::new(DICT_VALUE_UNKNOWN));
            }
            return Ok(Value::String(resolved));
        }
        match (column.kind, value) {
            (ColumnKind::Text { .. }, Value::String(text)) => Ok(Value::String(text)),
            (ColumnKind::Integer, Value::Number(number)) if number.is_i64() => {
                Ok(Value::Number(number))
            }
            (ColumnKind::Integer, Value::String(text)) if human => text
                .trim()
                .parse::<i64>()
                .map(Value::from)
                .map_err(|_| invalid(column.key)),
            (ColumnKind::Boolean, Value::Bool(value)) => Ok(Value::Bool(value)),
            (ColumnKind::Boolean, Value::String(text)) if human => {
                match text.trim().to_lowercase().as_str() {
                    "true" | "1" | "是" | "yes" => Ok(Value::Bool(true)),
                    "false" | "0" | "否" | "no" => Ok(Value::Bool(false)),
                    _ => Err(invalid(column.key)),
                }
            }
            (ColumnKind::Timestamp, Value::String(text)) => text
                .parse::<jiff::Timestamp>()
                .map(|time| Value::String(time.to_string()))
                .map_err(|_| invalid(column.key)),
            (ColumnKind::List { max_items }, Value::String(text)) if human => {
                let items = text
                    .split([',', '，', '、'])
                    .map(str::trim)
                    .filter(|item| !item.is_empty())
                    .map(|item| Value::String(item.into()))
                    .collect::<Vec<_>>();
                if items.len() > max_items {
                    Err(invalid(column.key))
                } else {
                    Ok(Value::Array(items))
                }
            }
            (ColumnKind::List { max_items }, Value::Array(items))
                if items.len() <= max_items && items.iter().all(Value::is_string) =>
            {
                Ok(Value::Array(items))
            }
            _ => Err(invalid(column.key)),
        }
    }

    fn human_text(&self, column: &ExchangeColumn, value: &Value) -> Result<String, AppError> {
        if value.is_null() {
            return Ok(String::new());
        }
        if let Some(dict) = column.dict {
            return self.dictionaries.label(
                dict,
                value.as_str().ok_or_else(|| invalid(column.key))?,
                self.language,
            );
        }
        Ok(match value {
            Value::String(text) if column.kind == ColumnKind::Timestamp => text
                .parse::<jiff::Timestamp>()
                .map_err(|_| invalid(column.key))?
                .to_zoned(jiff::tz::TimeZone::system())
                .strftime("%Y-%m-%dT%H:%M:%S%:z")
                .to_string(),
            Value::String(text) => text.clone(),
            Value::Bool(value) => value.to_string(),
            Value::Number(value) => value.to_string(),
            Value::Array(items) => items
                .iter()
                .map(|item| item.as_str().ok_or_else(|| invalid(column.key)))
                .collect::<Result<Vec<_>, _>>()?
                .join(", "),
            _ => return Err(invalid(column.key)),
        })
    }

    pub fn write(
        &self,
        rows: &[ExchangeRow],
        cancellation: &crate::job::CancellationToken,
    ) -> Result<Vec<u8>, AppError> {
        if rows.len() > self.dataset.limits.export_rows {
            return Err(too_many(self.dataset.limits.export_rows));
        }
        let bytes = match self.format {
            ExchangeFormat::Csv => csv::write(self, rows, cancellation)?,
            ExchangeFormat::Xlsx => xlsx::write(self, rows, cancellation)?,
            ExchangeFormat::Json => json::write(self, rows, cancellation)?,
        };
        if bytes.len() > self.dataset.limits.file_bytes {
            return Err(AppError::new(FILE_TOO_LARGE));
        }
        Ok(bytes)
    }
}

#[cfg(test)]
mod tests;
