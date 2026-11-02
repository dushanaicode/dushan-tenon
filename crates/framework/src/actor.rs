//! 可信入口提供的执行主体与追踪上下文；不承担鉴权，仅依赖 id。

use crate::id::Id;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Actor {
    System,
    User(Id),
}

impl Actor {
    pub(crate) fn audit_value(self) -> String {
        match self {
            Self::System => "system".to_owned(),
            Self::User(id) => id.to_string(),
        }
    }
}

/// 主体由可信的用例入口提供；本类型不承担登录或权限校验。
#[derive(Clone, Debug)]
pub struct ExecutionContext {
    pub actor: Actor,
    pub trace_id: String,
}

impl ExecutionContext {
    pub fn new(actor: Actor, trace_id: impl Into<String>) -> Self {
        Self {
            actor,
            trace_id: trace_id.into(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn context_preserves_trusted_actor_and_audit_identity() {
        assert_eq!(Actor::System.audit_value(), "system");
        let id = Id::new();
        let context = ExecutionContext::new(Actor::User(id), "trace");
        assert_eq!(context.actor, Actor::User(id));
        assert_eq!(context.actor.audit_value(), id.to_string());
        assert_eq!(context.trace_id, "trace");
    }
}
