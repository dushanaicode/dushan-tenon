use super::*;
use crate::{CAPTCHA_INVALID, CAPTCHA_REQUIRED, UserPasswordChange};
const PASSWORD: &str = "member-password";
const NEW_PASSWORD: &str = "changed-password";
async fn service(test: &TestDb, login: bool) -> AccountService {
    let policy = if login {
        AuthPolicy {
            captcha_after_failures: 1,
            lock_after_failures: 2,
            ..policy(AuthMode::Login)
        }
    } else {
        policy(AuthMode::None)
    };
    start_service(test, policy, clock()).await
}
fn context(id: Id) -> ExecutionContext {
    ExecutionContext::new(Actor::User(id), "users-test")
}
fn owner(service: &AccountService) -> ExecutionContext {
    context(service.owner_id().unwrap())
}
async fn user(test: &TestDb, id: Id) -> User {
    test.db
        .fetch_optional(&user_select().and_where(Expr::col("id").eq(id)).to_owned())
        .await
        .unwrap()
        .unwrap()
}
async fn login(service: &AccountService, password: &str) -> Result<(), AppError> {
    service
        .login(LoginInput {
            password: password.into(),
            captcha: None,
        })
        .await
}
async fn answer(service: &AccountService) -> CaptchaAnswer {
    let c = service.captcha().await.unwrap();
    CaptchaAnswer {
        id: c.id.clone(),
        answer: String::from_utf8(
            service
                .started()
                .unwrap()
                .cache
                .get("account.captcha", &c.id)
                .await
                .unwrap()
                .unwrap(),
        )
        .unwrap(),
    }
}
async fn enable(service: &AccountService) {
    service
        .enable_login(&owner(service), PASSWORD.into())
        .await
        .unwrap();
}
#[tokio::test(flavor = "current_thread")]
async fn self_password_change_uses_attempts_and_keeps_only_this_session() {
    test_support::run(async |test| {
        let admin = service(test, false).await;
        let owner_id = admin.owner_id().unwrap();
        let change = |current: &str, captcha| UserPasswordChange {
            current_password: current.into(),
            new_password: NEW_PASSWORD.into(),
            captcha,
        };
        assert_eq!(
            admin
                .user_password_change(&owner(&admin), change(PASSWORD, None))
                .await
                .unwrap_err()
                .code(),
            MODE_CONFLICT
        );
        enable(&admin).await;
        let client = service(test, true).await;
        login(&client, PASSWORD).await.unwrap();
        let old_id = client.session(false).await.unwrap().0;
        let me = context(owner_id);
        assert_eq!(
            client
                .user_password_change(&me, change("bad", None))
                .await
                .unwrap_err()
                .code(),
            INVALID_CREDENTIALS
        );
        assert_eq!(
            client
                .user_password_change(&me, change(PASSWORD, None))
                .await
                .unwrap_err()
                .code(),
            CAPTCHA_REQUIRED
        );
        let mut wrong = answer(&client).await;
        wrong.answer = "wrong".into();
        assert_eq!(
            client
                .user_password_change(&me, change(PASSWORD, Some(wrong)))
                .await
                .unwrap_err()
                .code(),
            CAPTCHA_INVALID
        );
        client
            .user_password_change(&me, change(PASSWORD, Some(answer(&client).await)))
            .await
            .unwrap();
        assert_eq!(client.resolve_active().await.unwrap().actor, me.actor);
        assert_old_session_rejected(&client, &old_id).await;
        assert_eq!(user(test, owner_id).await.row_version, 3);
        login(&client, NEW_PASSWORD).await.unwrap();
        assert_eq!(
            login(&client, PASSWORD).await.unwrap_err().code(),
            INVALID_CREDENTIALS
        );
    })
    .await;
}
