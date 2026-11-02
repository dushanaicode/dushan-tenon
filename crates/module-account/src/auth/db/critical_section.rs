use super::*;
use crate::db::fixture;
use std::{
    future::{Future, poll_fn},
    pin::Pin,
    sync::Barrier,
    task::Poll,
};
use tenon_framework::module::Module;

#[tokio::test(flavor = "current_thread")]
async fn active_user_work_holds_the_permit_until_completion_and_error_releases_it() {
    test_support::run(async |test| {
        let (account, _, _) = fixture(test, clock()).await;
        let owner = account.owner_id().unwrap();
        let context = ExecutionContext::new(Actor::User(owner), "critical");
        account
            .enable_login(&context, PASSWORD.into())
            .await
            .unwrap();
        for operation in 0..4 {
            account
                .login(LoginInput {
                    password: PASSWORD.into(),
                    captcha: None,
                })
                .await
                .unwrap();
            let release = Arc::new(Barrier::new(2));
            let work_release = release.clone();
            let (entered, ready) = tokio::sync::oneshot::channel();
            let work_account = account.clone();
            let work = std::thread::spawn(move || {
                tokio::runtime::Builder::new_current_thread()
                    .enable_all()
                    .build()
                    .unwrap()
                    .block_on(async move {
                        work_account
                            .with_active_user(owner, move || {
                                entered.send(()).unwrap();
                                work_release.wait();
                                Ok(42)
                            })
                            .await
                    })
            });
            ready.await.unwrap();
            let mut change: Pin<Box<dyn Future<Output = Result<(), AppError>> + Send + '_>> =
                match operation {
                    0 => Box::pin(account.lock()),
                    1 => Box::pin(account.logout(&context)),
                    2 => Box::pin(account.login(LoginInput {
                        password: PASSWORD.into(),
                        captcha: None,
                    })),
                    3 => Box::pin(account.stop()),
                    _ => panic!("unexpected test operation"),
                };
            let blocked = poll_fn(|cx| Poll::Ready(change.as_mut().poll(cx).is_pending())).await;
            // 在操作之后排入探针。额外许可应预留给已排队的操作，而不是探针；
            // 这样不会把“正在等待 Argon2/数据库”误当成“正在等待认证许可”。
            let queued = if blocked {
                let mut probe = Box::pin(account.operations.acquire());
                poll_fn(|cx| {
                    assert!(probe.as_mut().poll(cx).is_pending());
                    Poll::Ready(())
                })
                .await;
                account.operations.add_permits(1);
                poll_fn(|cx| Poll::Ready(probe.as_mut().poll(cx).is_pending())).await
            } else {
                false
            };
            let before = account.resolve_public().await;
            release.wait();
            assert_eq!(work.join().unwrap().unwrap(), Some(42));
            if blocked {
                assert_eq!(account.operations.forget_permits(1), 1);
            }
            assert!(blocked && queued, "认证操作必须先排队等待同一许可");
            assert_eq!(before.unwrap(), Some(Actor::User(owner)));
            change.await.unwrap();
            if operation == 2 {
                assert_eq!(
                    account.resolve_active().await.unwrap().actor,
                    Actor::User(owner)
                );
            } else {
                assert_eq!(account.resolve_public().await.unwrap(), None);
            }
        }
        let never = || -> Result<(), AppError> { panic!("inactive recipient must not execute") };
        assert_eq!(account.with_active_user(owner, never).await.unwrap(), None);
        account
            .login(LoginInput {
                password: PASSWORD.into(),
                captcha: None,
            })
            .await
            .unwrap();
        assert_eq!(
            account.with_active_user(Id::new(), never).await.unwrap(),
            None
        );
        account.lock().await.unwrap();
        assert_eq!(account.with_active_user(owner, never).await.unwrap(), None);
        account.unlock(&context, proof(PASSWORD)).await.unwrap();
        assert_eq!(
            account
                .with_active_user(owner, || Err::<(), _>(AppError::new(INTERNAL_UNEXPECTED)))
                .await
                .unwrap_err()
                .code(),
            INTERNAL_UNEXPECTED
        );
        account.logout(&context).await.unwrap();
    })
    .await;
}
