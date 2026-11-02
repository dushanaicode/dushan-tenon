//! 宿主显式注册模块；启用表只控制运行，全部编译模块的迁移始终保留。

mod aggregate;
mod capability;
mod extensions;
mod validate;
pub use aggregate::{BUILTIN, ERROR_CODES};
pub use capability::Capability;
pub use extensions::{Extensions, Identity, ModuleExtensions};

use std::{
    collections::{BTreeMap, BTreeSet},
    future::Future,
    pin::Pin,
    sync::{Arc, Mutex},
};

use serde::Serialize;
use ts_rs::TS;

use crate::{
    cache::Cache,
    db::{
        Db,
        migrate::{Migration, MigrationRecord},
    },
    dict::DictDeclaration,
    error::{AppError, ErrorCode, INTERNAL_UNEXPECTED, MODULE_DISABLED},
    file::{FilePurposeDeclaration, FileStore},
    i18n::Translator,
    job::ScheduleDeclaration,
    param::{ParamDeclaration, ParamKind, ParamStore},
};

pub type ModuleFuture<'a> = Pin<Box<dyn Future<Output = Result<(), AppError>> + Send + 'a>>;

pub struct ModuleDeclaration {
    pub id: &'static str,
    pub version: &'static str,
    pub dependencies: &'static [&'static str],
    pub required_capabilities: &'static [Capability],
    pub core: bool,
    pub migrations: &'static [Migration],
    pub error_codes: &'static [ErrorCode],
    pub permissions: &'static [&'static str],
    pub job_kinds: &'static [&'static str],
    pub schedules: &'static [ScheduleDeclaration],
    pub message_keys: &'static [&'static str],
    pub dictionaries: &'static [DictDeclaration],
    pub params: &'static [ParamDeclaration],
    pub file_purposes: &'static [FilePurposeDeclaration],
}

#[derive(Clone, Copy)]
pub struct ModuleContext<'a> {
    /// 同一次冻结的只读结果；start 仅提取并保存所需句柄，不保存整个 Extensions。
    pub extensions: &'a Extensions,
    pub db: &'a Db,
    pub cache: &'a Cache,
    pub permissions: &'a [&'static str],
    pub dictionaries: &'a [DictDeclaration],
    pub params: &'a ParamStore,
    pub files: &'a FileStore,
    pub translator: &'a Arc<dyn Translator>,
}

pub trait Module: Send + Sync {
    fn declaration(&self) -> &ModuleDeclaration;
    /// 声明校验后收集一次；freeze 合并宿主处理器，检查任务与身份槽。
    /// 完成钩子可为空，身份三槽各恰好一个；全部模块启动成功后才运行提供者。
    fn extensions(self: Arc<Self>) -> ModuleExtensions {
        ModuleExtensions::default()
    }
    fn start<'a>(&'a self, context: ModuleContext<'a>) -> ModuleFuture<'a>;
    fn stop(&self) -> ModuleFuture<'_>;
}

#[derive(Debug, thiserror::Error)]
pub enum RegistryError {
    #[error("模块 {module} 所需的内核能力不可用: {}", capability.as_str())]
    CapabilityUnavailable {
        module: String,
        capability: Capability,
    },
    #[error("扩展槽 {slot} 存在重复提供者: {modules:?}")]
    DuplicateProvider {
        slot: &'static str,
        modules: Vec<String>,
    },
    #[error("缺少必需的扩展提供者: {slot}")]
    MissingProvider { slot: &'static str },
    #[error("模块 {module} 的文件用途声明非法或重复: {code}")]
    InvalidFilePurpose { module: String, code: String },
    #[error("模块 {module} 的参数声明非法或重复: {key}")]
    InvalidParam { module: String, key: String },
    #[error("模块 {module} 的字典声明非法或重复: {code}")]
    InvalidDictionary { module: String, code: String },
    #[error("模块 {module} 的后端文案键前缀非法: {key}")]
    InvalidMessageKey { module: String, key: String },
    #[error("模块 {module} 的计划声明非法或重复: {key}")]
    InvalidSchedule { module: String, key: String },
    #[error("模块 {module} 的任务声明或处理器不一致: {kind}")]
    InvalidJob { module: String, kind: String },
    #[error("模块 ID 非法或保留: {0}")]
    InvalidId(String),
    #[error("重复模块 ID: {0}")]
    Duplicate(String),
    #[error("模块 {module} 的权限键非法: {permission}")]
    InvalidPermission { module: String, permission: String },
    #[error("重复权限键: {0}")]
    DuplicatePermission(String),
    #[error("模块 {module} 的依赖 {dependency} 未注册")]
    MissingDependency { module: String, dependency: String },
    #[error("模块依赖成环: {0}")]
    Cycle(String),
    #[error("模块 {0} 的版本为空")]
    InvalidVersion(String),
    #[error("模块 {module} 的迁移声明非法: {source}")]
    InvalidMigration { module: String, source: AppError },
    #[error("模块 {module} 的错误码非法或重复: {code}")]
    InvalidErrorCode { module: String, code: String },
    #[error("启用表包含未知模块: {0}")]
    UnknownModule(String),
    #[error("核心模块不可禁用: {0}")]
    CoreDisabled(String),
    #[error("已启用模块 {module} 的依赖 {dependency} 被禁用")]
    DisabledDependency { module: String, dependency: String },
}

#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct ModuleInfo {
    pub id: String,
    pub version: String,
    pub enabled: bool,
    pub core: bool,
    pub applied_migrations: u32,
}

pub struct ModuleRegistry {
    modules: Vec<Arc<dyn Module>>,
    order: Vec<usize>,
    enabled: Vec<bool>,
    started: Mutex<Vec<usize>>,
    extensions: Vec<ModuleExtensions>,
}

impl ModuleRegistry {
    /// 声明校验独立于运行处理器绑定；未指定的模块保持启用。
    pub fn new(
        modules: Vec<Arc<dyn Module>>,
        settings: &BTreeMap<String, bool>,
    ) -> Result<Self, RegistryError> {
        let ids = validate::modules(&modules)?;
        validate::permissions(&modules)?;
        validate::jobs_and_schedules(&modules)?;
        validate::message_keys(&modules)?;
        validate::dictionaries(&modules)?;
        validate::params(&modules)?;
        validate::file_purposes(&modules)?;
        let mut order = Vec::new();
        let mut visiting = vec![false; modules.len()];
        for index in 0..modules.len() {
            visit(index, &modules, &ids, &mut visiting, &mut order)?;
        }
        let enabled = validate::enabled(&modules, &ids, settings)?;
        let extensions = modules
            .iter()
            .map(|module| module.clone().extensions())
            .collect();
        Ok(Self {
            modules,
            order,
            enabled,
            started: Mutex::new(Vec::new()),
            extensions,
        })
    }

    /// 按依赖拓扑返回全部声明，包含停用模块，不调用运行期提供者。
    pub fn declarations(&self) -> impl Iterator<Item = &ModuleDeclaration> {
        self.order
            .iter()
            .map(|&index| self.modules[index].declaration())
    }

    pub fn contains(&self, id: &str) -> bool {
        self.modules
            .iter()
            .any(|module| module.declaration().id == id)
    }

    pub fn migrations(&self) -> Vec<Migration> {
        let mut result = crate::migrations::MIGRATIONS.to_vec();
        for &index in &self.order {
            let mut migrations = self.modules[index].declaration().migrations.to_vec();
            migrations.sort_by_key(|migration| migration.info.version);
            result.extend(migrations);
        }
        result
    }

    pub fn error_codes(&self) -> impl Iterator<Item = ErrorCode> + '_ {
        ERROR_CODES
            .iter()
            .copied()
            .chain(self.order.iter().flat_map(|&index| {
                self.modules[index]
                    .declaration()
                    .error_codes
                    .iter()
                    .copied()
            }))
    }

    pub fn permissions(&self) -> Vec<&'static str> {
        self.order
            .iter()
            .flat_map(|&index| {
                self.modules[index]
                    .declaration()
                    .permissions
                    .iter()
                    .copied()
            })
            .collect()
    }

    pub fn job_kinds(&self) -> Vec<&'static str> {
        self.order
            .iter()
            .flat_map(|&index| self.modules[index].declaration().job_kinds.iter().copied())
            .collect()
    }

    pub fn message_keys(&self) -> Vec<&'static str> {
        self.order
            .iter()
            .flat_map(|&index| {
                self.modules[index]
                    .declaration()
                    .message_keys
                    .iter()
                    .copied()
            })
            .collect()
    }

    pub fn dictionaries(&self) -> Vec<DictDeclaration> {
        BUILTIN
            .iter()
            .copied()
            .chain(self.order.iter().flat_map(|&index| {
                self.modules[index]
                    .declaration()
                    .dictionaries
                    .iter()
                    .copied()
            }))
            .collect()
    }

    pub fn dictionary_message_keys(&self) -> Vec<String> {
        self.dictionaries()
            .iter()
            .flat_map(|declaration| {
                std::iter::once(format!("dict.{}", declaration.code)).chain(
                    declaration
                        .items
                        .iter()
                        .map(|item| format!("dict.{}.{}", declaration.code, item.value)),
                )
            })
            .collect()
    }

    pub fn params(&self) -> Vec<ParamDeclaration> {
        self.order
            .iter()
            .flat_map(|&index| self.modules[index].declaration().params.iter().copied())
            .collect()
    }

    pub fn param_message_keys(&self) -> Vec<String> {
        let mut groups = BTreeSet::new();
        self.params()
            .iter()
            .flat_map(|d| {
                let mut keys = vec![
                    format!("param.{}.name", d.key),
                    format!("param.{}.description", d.key),
                ];
                if let ParamKind::Choice { values } = d.kind {
                    keys.extend(values.iter().map(|v| format!("param.{}.choice.{v}", d.key)));
                }
                if groups.insert(d.group) {
                    keys.push(format!("param.group.{}", d.group));
                }
                keys
            })
            .collect()
    }

    pub fn file_purposes(&self) -> Vec<FilePurposeDeclaration> {
        self.order
            .iter()
            .flat_map(|&index| {
                self.modules[index]
                    .declaration()
                    .file_purposes
                    .iter()
                    .copied()
            })
            .collect()
    }

    pub fn file_purpose_message_keys(&self) -> Vec<String> {
        self.file_purposes()
            .iter()
            .map(|d| format!("file.purpose.{}", d.code))
            .collect()
    }

    pub fn schedules(&self) -> Vec<ScheduleDeclaration> {
        self.order
            .iter()
            .flat_map(|&index| self.modules[index].declaration().schedules.iter().copied())
            .collect()
    }

    pub fn list(&self, applied: &[MigrationRecord]) -> Vec<ModuleInfo> {
        self.order
            .iter()
            .map(|&index| {
                let declaration = self.modules[index].declaration();
                ModuleInfo {
                    id: declaration.id.into(),
                    version: declaration.version.into(),
                    enabled: self.enabled[index],
                    core: declaration.core,
                    applied_migrations: applied
                        .iter()
                        .filter(|record| record.module == declaration.id)
                        .count() as u32,
                }
            })
            .collect()
    }

    pub fn guard(&self, command: &str) -> Result<(), AppError> {
        let Some((id, _)) = command.split_once('_') else {
            return Err(AppError::new(INTERNAL_UNEXPECTED));
        };
        if id == "app" {
            return Ok(());
        }
        match self
            .modules
            .iter()
            .position(|module| module.declaration().id == id)
        {
            Some(index) if self.enabled[index] => Ok(()),
            Some(_) => Err(AppError::new(MODULE_DISABLED).with_param("module", id)),
            None => Err(AppError::new(INTERNAL_UNEXPECTED)),
        }
    }

    /// 每个注册表启动一次；失败回收只覆盖已经成功启动的模块。
    pub async fn start(&mut self, context: ModuleContext<'_>) -> Result<(), AppError> {
        // 先检查关闭栈，再启动服务；不能在启动成功后才发现无法登记资源。
        let started = self
            .started
            .get_mut()
            .map_err(|_| AppError::new(INTERNAL_UNEXPECTED))?;
        for &index in &self.order {
            if !self.enabled[index] {
                continue;
            }
            if let Err(error) = self.modules[index].start(context).await {
                if let Err(cleanup) = self.stop().await {
                    tracing::error!(error = ?cleanup, "模块启动失败后的回收失败");
                }
                return Err(error);
            }
            started.push(index);
        }
        Ok(())
    }

    /// 单个 stop 失败不影响其余模块释放，返回首个错误。
    pub async fn stop(&self) -> Result<(), AppError> {
        let started = std::mem::take(
            &mut *self
                .started
                .lock()
                .map_err(|_| AppError::new(INTERNAL_UNEXPECTED))?,
        );
        let mut first_error = None;
        for index in started.into_iter().rev() {
            if let Err(error) = self.modules[index].stop().await {
                tracing::error!(module = self.modules[index].declaration().id, error = ?error, "模块关闭失败");
                if first_error.is_none() {
                    first_error = Some(error);
                }
            }
        }
        first_error.map_or(Ok(()), Err)
    }
}

fn visit(
    index: usize,
    modules: &[Arc<dyn Module>],
    ids: &BTreeMap<&str, usize>,
    visiting: &mut [bool],
    order: &mut Vec<usize>,
) -> Result<(), RegistryError> {
    if order.contains(&index) {
        return Ok(());
    }
    let declaration = modules[index].declaration();
    if visiting[index] {
        return Err(RegistryError::Cycle(declaration.id.into()));
    }
    visiting[index] = true;
    for dependency in declaration.dependencies {
        let dependency_index =
            ids.get(dependency)
                .ok_or_else(|| RegistryError::MissingDependency {
                    module: declaration.id.into(),
                    dependency: (*dependency).into(),
                })?;
        visit(*dependency_index, modules, ids, visiting, order)?;
    }
    visiting[index] = false;
    order.push(index);
    Ok(())
}

#[cfg(test)]
mod tests;
