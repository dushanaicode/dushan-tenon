//! 私有持久化：只修改具体操作提供的字段，同目录原子替换成功后提交内存。

use std::{io::Write, path::Path};

use serde::Serialize;
use tenon_framework::error::{AppError, INPUT_INVALID, INTERNAL_UNEXPECTED};

use super::{AppConfig, ConfigError, ConfigSource, ConfigSources, LoadedConfig};

pub(super) struct Change {
    key: &'static str,
    value: toml_edit::Value,
}

pub(super) fn change<T: PartialEq + Serialize>(
    sources: &ConfigSources,
    changes: &mut Vec<Change>,
    key: &'static str,
    current: &mut T,
    value: T,
) -> Result<(), AppError> {
    sources.check_writable(key)?;
    if *current != value {
        changes.push(Change {
            key,
            value: encode(&value)?,
        });
        *current = value;
    }
    Ok(())
}

/// 只序列化单个受控字段，不把运行期配置转回原始 TOML 模型。
pub(super) fn encode(value: &impl Serialize) -> Result<toml_edit::Value, AppError> {
    toml::Value::try_from(value)
        .map_err(internal)?
        .to_string()
        .parse()
        .map_err(internal)
}

pub(super) fn set_value(
    document: &mut toml_edit::DocumentMut,
    section: &str,
    field: &str,
    replacement: toml_edit::Value,
) -> Result<(), AppError> {
    let table = document
        .entry(section)
        .or_insert(toml_edit::Item::Table(toml_edit::Table::new()))
        .as_table_like_mut()
        .ok_or_else(|| AppError::new(INPUT_INVALID).with_param("path", section))?;
    let mut replacement = replacement;
    if let Some(item) = table.get_mut(field) {
        let existing = item.as_value().ok_or_else(|| {
            AppError::new(INPUT_INVALID).with_param("path", format!("{section}.{field}"))
        })?;
        *replacement.decor_mut() = existing.decor().clone();
        *item = toml_edit::Item::Value(replacement);
    } else {
        table.insert(field, toml_edit::Item::Value(replacement));
    }
    Ok(())
}

impl LoadedConfig {
    pub(super) fn commit(
        &mut self,
        root: &Path,
        values: AppConfig,
        changes: Vec<Change>,
    ) -> Result<(), AppError> {
        if changes.is_empty() {
            return Ok(());
        }
        let text = super::loader::read_file(root)
            .map_err(internal)?
            .unwrap_or_default();
        let mut document = text.parse::<toml_edit::DocumentMut>().map_err(internal)?;
        for change in &changes {
            let (section, field) = change
                .key
                .split_once('.')
                .ok_or_else(|| AppError::new(INTERNAL_UNEXPECTED))?;
            set_value(&mut document, section, field, change.value.clone())?;
        }
        let mut temporary = tempfile::NamedTempFile::new_in(root).map_err(internal)?;
        temporary
            .write_all(document.to_string().as_bytes())
            .map_err(internal)?;
        temporary.as_file().sync_all().map_err(internal)?;
        temporary
            .persist(root.join("config.toml"))
            .map_err(|error| internal(error.error))?;
        self.values = values;
        self.sources.file_exists = true;
        for change in changes {
            self.sources
                .effective
                .insert(change.key.into(), ConfigSource::File);
        }
        Ok(())
    }
}

pub(super) fn internal(error: impl std::error::Error + Send + Sync + 'static) -> AppError {
    AppError::new(INTERNAL_UNEXPECTED).with_source(error)
}

pub(super) fn invalid(error: ConfigError) -> AppError {
    match error {
        ConfigError::Field { path, .. } => AppError::new(INPUT_INVALID).with_param("path", path),
        error => internal(error),
    }
}
