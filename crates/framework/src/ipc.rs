//! 命令身份、权限和准入；模块检查由宿主提供，许可持续到命令日志完成。

use std::{
    collections::BTreeMap, error::Error, future::Future, ops::Deref, pin::Pin, time::Instant,
};

use tracing::Instrument;
use uuid::Uuid;

use crate::error::{AppError, INTERNAL_UNEXPECTED, IpcError};
use crate::{
    actor::{Actor, ExecutionContext},
    maintenance::{CommandAdmission, OperationGate},
};

/// 身份扩展槽恰好一个已启用提供者；缺失或重复启动失败，不提供缺省身份。
pub trait ActorResolver: Send + Sync {
    fn resolve_active(
        &self,
    ) -> Pin<Box<dyn Future<Output = Result<ActiveActor, AppError>> + Send + '_>>;
    fn resolve_session(&self)
    -> Pin<Box<dyn Future<Output = Result<Actor, AppError>> + Send + '_>>;
    fn resolve_public(
        &self,
    ) -> Pin<Box<dyn Future<Output = Result<Option<Actor>, AppError>> + Send + '_>>;
}

/// 单次活动身份解析的结果；权限与本次读取的用户版本一致，不跨请求复用。
#[derive(Debug)]
pub struct ActiveActor {
    pub actor: Actor,
    pub permissions: Vec<String>,
}

/// 权限检查扩展槽恰好一个已启用提供者；缺失或重复启动失败，不默认放行。
pub trait PermissionChecker: Send + Sync {
    fn check(&self, actor: &ActiveActor, key: &str) -> Result<(), AppError>;
}

pub trait IpcContext {
    fn admission(&self) -> &OperationGate;
    fn command_admission(&self, command: &str) -> CommandAdmission;
    /// 宿主委托注册表检查命令所属模块；必须先于身份解析。
    fn guard_module(&self, command: &str) -> Result<(), AppError>;
    fn actor_resolver(&self) -> &dyn ActorResolver;
    fn permission_checker(&self) -> &dyn PermissionChecker;
    fn required_permissions(&self, command: &str) -> Vec<&'static str>;
}

/// 保持命令的单参数闭包写法；资源仍通过宿主显式传入。
pub struct Invocation<'a, C> {
    state: &'a C,
    pub execution: ExecutionContext,
}

impl<C> Deref for Invocation<'_, C> {
    type Target = C;
    fn deref(&self) -> &C {
        self.state
    }
}

pub struct PublicInvocation<'a, C> {
    state: &'a C,
    pub trace_id: String,
    pub actor: Option<Actor>,
}

impl<C> Deref for PublicInvocation<'_, C> {
    type Target = C;
    fn deref(&self) -> &C {
        self.state
    }
}

/// 仅 main capability 与参数校验保护的控制入口，不解析身份或访问数据库。
/// 备份取消由备份命令自身的 app.backup.cancelled outcome 写入运行日志。
pub async fn execute_control<C: IpcContext, T>(
    context: &C,
    command: &'static str,
    use_case: impl FnOnce() -> Result<T, AppError>,
) -> Result<T, IpcError> {
    let trace_id = Uuid::now_v7().to_string();
    command_module(command).map_err(|error| map_error(error, trace_id.clone()))?;
    if context.command_admission(command) != CommandAdmission::Control {
        return Err(map_error(AppError::new(INTERNAL_UNEXPECTED), trace_id));
    }
    context
        .admission()
        .enter_control()
        .and_then(|()| context.guard_module(command))
        .and_then(|()| use_case())
        .map_err(|error| map_error(error, trace_id))
}

pub async fn execute<'a, C, T, F>(
    context: &'a C,
    command: &'static str,
    use_case: impl FnOnce(Invocation<'a, C>) -> F,
) -> Result<T, IpcError>
where
    C: IpcContext,
    F: Future<Output = Result<T, AppError>>,
{
    dispatch(
        context,
        command,
        || async {
            let actor = context.actor_resolver().resolve_active().await?;
            context
                .required_permissions(command)
                .into_iter()
                .try_for_each(|permission| context.permission_checker().check(&actor, permission))
        },
        |trace_id| async move {
            let actor = context.actor_resolver().resolve_active().await?;
            for permission in context.required_permissions(command) {
                context.permission_checker().check(&actor, permission)?;
            }
            use_case(Invocation {
                state: context,
                execution: ExecutionContext::new(actor.actor, trace_id),
            })
            .await
        },
    )
    .await
}

pub async fn execute_session<'a, C: IpcContext, T, F: Future<Output = Result<T, AppError>>>(
    context: &'a C,
    command: &'static str,
    use_case: impl FnOnce(Invocation<'a, C>) -> F,
) -> Result<T, IpcError> {
    dispatch(
        context,
        command,
        || async { context.actor_resolver().resolve_session().await.map(|_| ()) },
        |trace_id| async move {
            let actor = context.actor_resolver().resolve_session().await?;
            use_case(Invocation {
                state: context,
                execution: ExecutionContext::new(actor, trace_id),
            })
            .await
        },
    )
    .await
}

pub async fn execute_public<'a, C: IpcContext, T, F: Future<Output = Result<T, AppError>>>(
    context: &'a C,
    command: &'static str,
    use_case: impl FnOnce(PublicInvocation<'a, C>) -> F,
) -> Result<T, IpcError> {
    dispatch(
        context,
        command,
        || async { context.actor_resolver().resolve_public().await.map(|_| ()) },
        |trace_id| async move {
            let actor = context.actor_resolver().resolve_public().await?;
            use_case(PublicInvocation {
                state: context,
                trace_id,
                actor,
            })
            .await
        },
    )
    .await
}

async fn dispatch<C: IpcContext, T, A, F>(
    context: &C,
    command: &'static str,
    authorize: impl FnOnce() -> A,
    use_case: impl FnOnce(String) -> F,
) -> Result<T, IpcError>
where
    A: Future<Output = Result<(), AppError>>,
    F: Future<Output = Result<T, AppError>>,
{
    let trace_id = Uuid::now_v7().to_string();
    let module = command_module(command).map_err(|error| map_error(error, trace_id.clone()))?;
    // span 本身不发事件；使用 error 级，确保 warn/error 日志也保留命令与追踪字段。
    let span = tracing::error_span!("ipc", command, trace_id = %trace_id);
    async move {
        let started = Instant::now();
        // 身份解析也可能写入；拒绝准入后不得再调用解析器。
        let admission = context.command_admission(command);
        let permit = match admission {
            CommandAdmission::Control => Err(AppError::new(INTERNAL_UNEXPECTED)),
            CommandAdmission::Normal | CommandAdmission::Maintenance => context.admission().enter(),
        }
        .map_err(|error| map_error(error, trace_id.clone()))?;
        let mut permit = Some(permit);
        let mut _exclusive = None;
        let result = match context.guard_module(command) {
            Ok(()) if admission == CommandAdmission::Maintenance => {
                let authorization = authorize().await;
                match authorization {
                    Err(error) => Err(error),
                    Ok(()) => {
                        // 释放共享许可再申请独占；等待期间身份可能变化，use_case 前再次鉴权。
                        drop(permit.take());
                        _exclusive = Some(
                            context
                                .admission()
                                .quiesce()
                                .await
                                .map_err(|error| map_error(error, trace_id.clone()))?,
                        );
                        use_case(trace_id.clone()).await
                    }
                }
            }
            Ok(()) => use_case(trace_id.clone()).await,
            Err(error) => Err(error),
        };
        let outcome = result
            .as_ref()
            .err()
            .map_or("success", |error| error.code().as_str());
        tracing::info!(
            command,
            module,
            outcome,
            trace_id = %trace_id,
            duration_ms = started.elapsed().as_millis().min(i32::MAX as u128) as i32,
            "IPC 执行"
        );
        match result {
            Ok(value) => {
                tracing::debug!(
                    elapsed_ms = started.elapsed().as_secs_f64() * 1000.0,
                    "IPC 完成"
                );
                Ok(value)
            }
            Err(error) => Err(map_error(error, trace_id)),
        }
    }
    .instrument(span)
    .await
}

fn command_module(command: &str) -> Result<&str, AppError> {
    command
        .split_once('_')
        .filter(|(module, name)| !module.is_empty() && !name.is_empty())
        .map(|(module, _)| module)
        .ok_or_else(|| AppError::new(INTERNAL_UNEXPECTED))
}

fn map_error(error: AppError, trace_id: String) -> IpcError {
    if error.code == INTERNAL_UNEXPECTED {
        let mut sources = Vec::new();
        let mut source = error.source();
        while let Some(cause) = source {
            sources.push(cause.to_string());
            source = cause.source();
        }
        tracing::error!(code = %error.code, source_chain = ?sources, "IPC 内部错误");
        IpcError {
            code: INTERNAL_UNEXPECTED.as_str().to_owned(),
            params: BTreeMap::new(),
            trace_id,
        }
    } else {
        tracing::warn!(code = %error.code, params = ?error.params, "IPC 业务错误");
        IpcError {
            code: error.code.as_str().to_owned(),
            params: error
                .params
                .into_iter()
                .map(|(key, value)| (key.to_owned(), value))
                .collect(),
            trace_id,
        }
    }
}

#[cfg(test)]
mod tests;
