use super::{Module, RegistryError};
use crate::{
    db::migrate,
    dict::{valid_code, valid_value},
    error::{AppError, INTERNAL_UNEXPECTED, is_valid_code},
    file::KNOWN_EXTENSIONS,
    job::valid_key,
};
use std::{
    collections::{BTreeMap, BTreeSet},
    sync::Arc,
};

pub(super) fn modules(modules: &[Arc<dyn Module>]) -> Result<BTreeMap<&str, usize>, RegistryError> {
    let mut ids = BTreeMap::new();
    let mut codes = BTreeSet::new();
    for (index, module) in modules.iter().enumerate() {
        let declaration = module.declaration();
        let id = declaration.id;
        if matches!(id, "app" | "framework")
            || !id.starts_with(|c: char| c.is_ascii_lowercase())
            || !id
                .bytes()
                .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit())
        {
            return Err(RegistryError::InvalidId(id.into()));
        }
        if ids.insert(id, index).is_some() {
            return Err(RegistryError::Duplicate(id.into()));
        }
        if declaration.version.trim().is_empty() {
            return Err(RegistryError::InvalidVersion(id.into()));
        }
        if declaration
            .migrations
            .iter()
            .any(|migration| migration.info.module != id)
        {
            return Err(RegistryError::InvalidMigration {
                module: id.into(),
                source: AppError::new(INTERNAL_UNEXPECTED),
            });
        }
        let mut migrations: Vec<_> = declaration
            .migrations
            .iter()
            .map(|migration| migration.info)
            .collect();
        migrations.sort_by_key(|info| info.version);
        migrate::validate_registry(migrations).map_err(|source| {
            RegistryError::InvalidMigration {
                module: id.into(),
                source,
            }
        })?;
        for &code in declaration.error_codes {
            if code.as_str().split('.').next() != Some(id) || !codes.insert(code) {
                return Err(RegistryError::InvalidErrorCode {
                    module: id.into(),
                    code: code.to_string(),
                });
            }
        }
    }
    Ok(ids)
}

pub(super) fn permissions(modules: &[Arc<dyn Module>]) -> Result<(), RegistryError> {
    let mut permissions = BTreeSet::new();
    for module in modules {
        let declaration = module.declaration();
        for &permission in declaration.permissions {
            if !is_valid_code(permission) || permission.split('.').next() != Some(declaration.id) {
                return Err(RegistryError::InvalidPermission {
                    module: declaration.id.into(),
                    permission: permission.into(),
                });
            }
            if !permissions.insert(permission) {
                return Err(RegistryError::DuplicatePermission(permission.into()));
            }
        }
    }
    Ok(())
}

pub(super) fn jobs_and_schedules(modules: &[Arc<dyn Module>]) -> Result<(), RegistryError> {
    let mut kinds = BTreeSet::new();
    let mut schedules = BTreeSet::new();
    for module in modules {
        let declaration = module.declaration();
        let id = declaration.id;
        for &kind in declaration.job_kinds {
            if !valid_key(kind, id) || !kinds.insert(kind) {
                return Err(RegistryError::InvalidJob {
                    module: id.into(),
                    kind: kind.into(),
                });
            }
        }
        for schedule in declaration.schedules {
            if !valid_key(schedule.key, id)
                || !schedules.insert(schedule.key)
                || !declaration.job_kinds.contains(&schedule.kind)
            {
                return Err(RegistryError::InvalidSchedule {
                    module: id.into(),
                    key: schedule.key.into(),
                });
            }
        }
    }
    Ok(())
}

pub(super) fn message_keys(modules: &[Arc<dyn Module>]) -> Result<(), RegistryError> {
    for module in modules {
        let declaration = module.declaration();
        for &key in declaration.message_keys {
            let valid = key.split_once('.').is_some_and(|(prefix, name)| {
                (prefix == declaration.id || ["jobs", "errors", "exchange"].contains(&prefix))
                    && !name.is_empty()
                    && name.split('.').all(|part| {
                        !part.is_empty()
                            && part.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'_')
                    })
            });
            if !valid {
                return Err(RegistryError::InvalidMessageKey {
                    module: declaration.id.into(),
                    key: key.into(),
                });
            }
        }
    }
    Ok(())
}

pub(super) fn dictionaries(modules: &[Arc<dyn Module>]) -> Result<(), RegistryError> {
    let mut dictionaries = BTreeSet::new();
    for module in modules {
        let id = module.declaration().id;
        for declaration in module.declaration().dictionaries {
            let mut values = BTreeSet::new();
            if !valid_code(declaration.code, id)
                || !dictionaries.insert(declaration.code)
                || declaration.items.is_empty()
                || declaration
                    .items
                    .iter()
                    .any(|item| !valid_value(item.value) || !values.insert(item.value))
            {
                return Err(RegistryError::InvalidDictionary {
                    module: id.into(),
                    code: declaration.code.into(),
                });
            }
        }
    }
    Ok(())
}

pub(super) fn params(modules: &[Arc<dyn Module>]) -> Result<(), RegistryError> {
    let mut params: BTreeSet<&str> = BTreeSet::new();
    for module in modules {
        let module = module.declaration();
        for declaration in module.params {
            let key = declaration.key;
            if !declaration.valid(module.id, module.permissions)
                || params.iter().any(|other| {
                    key == *other
                        || key.strip_prefix(other).is_some_and(|s| s.starts_with('.'))
                        || other.strip_prefix(key).is_some_and(|s| s.starts_with('.'))
                })
            {
                return Err(RegistryError::InvalidParam {
                    module: module.id.into(),
                    key: key.into(),
                });
            }
            params.insert(key);
        }
    }
    Ok(())
}

pub(super) fn file_purposes(modules: &[Arc<dyn Module>]) -> Result<(), RegistryError> {
    let mut purposes = BTreeSet::new();
    for module in modules {
        let id = module.declaration().id;
        for declaration in module.declaration().file_purposes {
            let mut extensions = BTreeSet::new();
            if !valid_code(declaration.code, id)
                || !purposes.insert(declaration.code)
                || declaration.extensions.is_empty()
                || declaration.extensions.iter().any(|ext| {
                    !(1..=16).contains(&ext.len())
                        || !ext
                            .bytes()
                            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit())
                        || !KNOWN_EXTENSIONS.contains(ext)
                        || !extensions.insert(ext)
                })
            {
                return Err(RegistryError::InvalidFilePurpose {
                    module: id.into(),
                    code: declaration.code.into(),
                });
            }
        }
    }
    Ok(())
}

pub(super) fn enabled(
    modules: &[Arc<dyn Module>],
    ids: &BTreeMap<&str, usize>,
    settings: &BTreeMap<String, bool>,
) -> Result<Vec<bool>, RegistryError> {
    for id in settings.keys() {
        if !ids.contains_key(id.as_str()) {
            return Err(RegistryError::UnknownModule(id.clone()));
        }
    }
    let enabled: Vec<_> = modules
        .iter()
        .map(|module| {
            settings
                .get(module.declaration().id)
                .copied()
                .unwrap_or(true)
        })
        .collect();
    for (index, module) in modules.iter().enumerate() {
        let declaration = module.declaration();
        if declaration.core && !enabled[index] {
            return Err(RegistryError::CoreDisabled(declaration.id.into()));
        }
        if enabled[index] {
            for dependency in declaration.dependencies {
                if !enabled[ids[dependency]] {
                    return Err(RegistryError::DisabledDependency {
                        module: declaration.id.into(),
                        dependency: (*dependency).into(),
                    });
                }
            }
        }
    }
    Ok(enabled)
}
