use super::*;
use crate::{
    INVALID_CREDENTIALS, LoginInput, PasswordProof, RecoverInput, SESSION_EXPIRED,
    auth::RuntimeState, db::fixture,
};
use sea_query::{Expr, ExprTrait, Query};
use serde_json::json;
use std::{
    sync::{Arc, atomic::AtomicI64},
    time::Duration,
};
use tenon_framework::{
    actor::{Actor, ExecutionContext},
    db::test_support,
    ipc::ActorResolver,
    job::PermissionLookup,
};

fn login() -> LoginInput {
    LoginInput {
        password: "owner-password".into(),
        captcha: None,
    }
}

async fn old_session(account: &AccountService, id: tenon_framework::id::Id) {
    let session = uuid::Uuid::new_v4().to_string();
    let now = (account.clock)();
    account
        .started()
        .unwrap()
        .cache
        .set_json(
            "account.session",
            &session,
            &json!({
                "user_id": id, "created_at": now,
                "last_activity_at": now, "locked": false,
            }),
            Duration::from_secs(3600),
        )
        .await
        .unwrap();
    *account.started().unwrap().state.lock().unwrap() = RuntimeState::Login {
        session: Some(session),
    };
}

#[tokio::test]
async fn owner_only_policy_covers_all_identity_entries_and_background_tasks() {
    test_support::run(async |test| {
        let (account, registry, _) =
            fixture(test, Arc::new(AtomicI64::new(1_700_000_000_000))).await;
        assert_eq!(
            account.resolve_active().await.unwrap().permissions,
            registry.permissions()
        );
        let active = account.resolve_active().await.unwrap();
        account.check(&active, "sample.service.read").unwrap();
        assert_eq!(
            account
                .check(&active, "unknown.permission")
                .unwrap_err()
                .code(),
            tenon_framework::error::PERMISSION_DENIED
        );
        let owner = account.owner_id().unwrap();
        assert!(
            !account
                .has_permission(Actor::User(owner), "unknown.permission")
                .await
                .unwrap()
        );
        assert!(
            !registry
                .list(&[])
                .iter()
                .find(|module| module.id == "optional")
                .unwrap()
                .enabled
        );
        assert!(
            account
                .has_permission(Actor::User(owner), "optional.feature.read")
                .await
                .unwrap()
        );
        assert!(
            account
                .has_permission(Actor::User(owner), "sample.service.send")
                .await
                .unwrap()
        );
        let other = tenon_framework::id::Id::new();
        let context = ExecutionContext::new(Actor::User(owner), "owner");
        account
            .enable_login(&context, "owner-password".into())
            .await
            .unwrap();
        account.login(login()).await.unwrap();
        let code = "0123-4567-89AB-CDEF";
        let hash = crate::hash_password(code.into()).await.unwrap();
        let mut tx = test.db.begin().await.unwrap();
        let recovery = tx
            .insert(
                tenon_framework::db::Table {
                    name: "account_recovery_code",
                    audit: true,
                    soft_delete: true,
                    optimistic_lock: false,
                },
                &context,
                [
                    ("user_id", other.into()),
                    (
                        "code_hash",
                        secrecy::ExposeSecret::expose_secret(&hash).into(),
                    ),
                    ("used_at", sea_query::Value::BigInt(None)),
                ],
            )
            .await
            .unwrap();
        tx.commit().await.unwrap();
        assert_eq!(
            account
                .recover(
                    RecoverInput {
                        recovery_code: code.into(),
                        new_password: "changed-password".into(),
                        captcha: None
                    },
                    "other-owner-recovery"
                )
                .await
                .err()
                .unwrap()
                .code(),
            INVALID_CREDENTIALS
        );
        let unused: (Option<tenon_framework::time::Timestamp>,) = test
            .db
            .fetch_optional(
                &Query::select()
                    .column("used_at")
                    .from("account_recovery_code")
                    .and_where(Expr::col("id").eq(recovery))
                    .to_owned(),
            )
            .await
            .unwrap()
            .unwrap();
        assert_eq!(unused.0, None);
        assert_eq!(
            account.resolve_active().await.unwrap().permissions,
            registry.permissions()
        );
        assert_eq!(
            account
                .login(LoginInput {
                    password: "wrong-password".into(),
                    captcha: None
                })
                .await
                .unwrap_err()
                .code(),
            INVALID_CREDENTIALS
        );
        assert_eq!(
            account.resolve_active().await.unwrap().actor,
            Actor::User(owner)
        );
        old_session(&account, other).await;
        assert_eq!(
            account.resolve_active().await.unwrap_err().code(),
            SESSION_EXPIRED
        );
        old_session(&account, other).await;
        assert_eq!(
            account.resolve_session().await.unwrap_err().code(),
            SESSION_EXPIRED
        );
        old_session(&account, other).await;
        assert_eq!(account.resolve_public().await.unwrap(), None);
        assert!(
            !account
                .has_permission(Actor::User(other), "sample.service.send")
                .await
                .unwrap()
        );
        assert!(
            account
                .has_permission(Actor::System, "undeclared.permission")
                .await
                .unwrap()
        );
        account.login(login()).await.unwrap();
        account
            .disable_login(
                &context,
                PasswordProof {
                    password: "owner-password".into(),
                    captcha: None,
                },
            )
            .await
            .unwrap();
        assert_eq!(
            account.resolve_active().await.unwrap().permissions,
            registry.permissions()
        );
    })
    .await;
}
