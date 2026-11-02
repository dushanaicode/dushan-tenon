use std::{collections::BTreeSet, sync::Arc};

use crate::{
    ipc::{ActorResolver, PermissionChecker},
    job::{JobCompletionHook, JobHandler, PermissionLookup},
};

use super::{ModuleRegistry, RegistryError};

/// 模块一次性贡献的运行期实现；与宿主处理器合并后才校验完整性。
/// 收集与冻结不调用业务方法；全部模块启动成功后才开放运行期使用。
#[derive(Default)]
pub struct ModuleExtensions {
    pub job_handlers: Vec<Arc<dyn JobHandler>>,
    /// 0..N，按依赖拓扑顺序及模块内顺序执行。
    pub job_completion_hooks: Vec<Arc<dyn JobCompletionHook>>,
    /// 以下三槽在启用模块中各恰好一个，不提供缺省身份或权限。
    pub actor_resolver: Option<Arc<dyn ActorResolver>>,
    pub permission_checker: Option<Arc<dyn PermissionChecker>>,
    pub permission_lookup: Option<Arc<dyn PermissionLookup>>,
}

/// 冻结时已校验的三个必需身份槽。
pub struct Identity {
    pub actor_resolver: Arc<dyn ActorResolver>,
    pub permission_checker: Arc<dyn PermissionChecker>,
    pub permission_lookup: Arc<dyn PermissionLookup>,
}

/// 已启用模块的冻结贡献，仅开放只读访问。
pub struct Extensions {
    identity: Identity,
    job_handlers: Vec<Arc<dyn JobHandler>>,
    job_completion_hooks: Vec<Arc<dyn JobCompletionHook>>,
}

impl Extensions {
    pub fn identity(&self) -> &Identity {
        &self.identity
    }

    pub fn job_handlers(&self) -> &[Arc<dyn JobHandler>] {
        &self.job_handlers
    }

    pub fn job_completion_hooks(&self) -> &[Arc<dyn JobCompletionHook>] {
        &self.job_completion_hooks
    }
}

impl ModuleRegistry {
    /// 启动前绑定模块与宿主处理器；kind 的模块前缀确定宿主处理器归属。
    /// 全部声明（含禁用模块）必须完整匹配；只有启用模块的实现进入冻结结果。
    pub fn freeze(
        &self,
        host_handlers: Vec<Arc<dyn JobHandler>>,
    ) -> Result<Extensions, RegistryError> {
        let mut handlers: Vec<_> = self
            .extensions
            .iter()
            .map(|e| e.job_handlers.clone())
            .collect();
        for handler in host_handlers {
            let kind = handler.kind();
            let (owner, _) = kind
                .split_once('.')
                .ok_or_else(|| RegistryError::InvalidJob {
                    module: kind.into(),
                    kind: kind.into(),
                })?;
            let index = self
                .modules
                .iter()
                .position(|module| module.declaration().id == owner)
                .ok_or_else(|| RegistryError::InvalidJob {
                    module: owner.into(),
                    kind: kind.into(),
                })?;
            handlers[index].push(handler);
        }
        self.validate_handlers(&handlers)?;
        let actor_resolver = self.provider("actor_resolver", |e| e.actor_resolver.as_ref())?;
        let permission_checker =
            self.provider("permission_checker", |e| e.permission_checker.as_ref())?;
        let permission_lookup =
            self.provider("permission_lookup", |e| e.permission_lookup.as_ref())?;
        let identity = Identity {
            actor_resolver: actor_resolver.ok_or(RegistryError::MissingProvider {
                slot: "actor_resolver",
            })?,
            permission_checker: permission_checker.ok_or(RegistryError::MissingProvider {
                slot: "permission_checker",
            })?,
            permission_lookup: permission_lookup.ok_or(RegistryError::MissingProvider {
                slot: "permission_lookup",
            })?,
        };
        let mut frozen = Extensions {
            identity,
            job_handlers: Vec::new(),
            job_completion_hooks: Vec::new(),
        };
        for &index in &self.order {
            if self.enabled[index] {
                frozen.job_handlers.append(&mut handlers[index]);
                frozen
                    .job_completion_hooks
                    .extend(self.extensions[index].job_completion_hooks.iter().cloned());
            }
        }
        Ok(frozen)
    }

    fn validate_handlers(
        &self,
        handlers: &[Vec<Arc<dyn JobHandler>>],
    ) -> Result<(), RegistryError> {
        let permissions: BTreeSet<_> = self.permissions().into_iter().collect();
        for (module, handlers) in self.modules.iter().zip(handlers) {
            let declaration = module.declaration();
            let mut seen = BTreeSet::new();
            for handler in handlers {
                let kind = handler.kind();
                if !declaration.job_kinds.contains(&kind)
                    || !seen.insert(kind)
                    || handler.max_attempts() < 1
                    || handler.concurrency() < 1
                    || handler
                        .permissions()
                        .iter()
                        .any(|key| !permissions.contains(key))
                {
                    return Err(RegistryError::InvalidJob {
                        module: declaration.id.into(),
                        kind: kind.into(),
                    });
                }
            }
            for &kind in declaration.job_kinds {
                if !seen.contains(kind) {
                    return Err(RegistryError::InvalidJob {
                        module: declaration.id.into(),
                        kind: kind.into(),
                    });
                }
            }
        }
        Ok(())
    }

    fn provider<T: ?Sized>(
        &self,
        slot: &'static str,
        select: fn(&ModuleExtensions) -> Option<&Arc<T>>,
    ) -> Result<Option<Arc<T>>, RegistryError> {
        let providers: Vec<_> = self
            .order
            .iter()
            .filter(|&&index| self.enabled[index])
            .filter_map(|&index| {
                select(&self.extensions[index])
                    .map(|provider| (self.modules[index].declaration().id, provider))
            })
            .collect();
        match providers.as_slice() {
            [] => Ok(None),
            [(_, provider)] => Ok(Some((*provider).clone())),
            _ => Err(RegistryError::DuplicateProvider {
                slot,
                modules: providers.iter().map(|(id, _)| (*id).into()).collect(),
            }),
        }
    }
}
