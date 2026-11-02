use super::*;

#[test]
fn multiple_permissions_are_checked_in_order_and_report_the_first_missing_key() {
    let _guard = IPC_TEST_LOCK.lock().unwrap();
    for (granted, missing, checked) in [
        (vec![], Some("app.test.allowed"), vec!["app.test.allowed"]),
        (
            vec!["app.test.second"],
            Some("app.test.allowed"),
            vec!["app.test.allowed"],
        ),
        (
            vec!["app.test.allowed"],
            Some("app.test.second"),
            vec!["app.test.allowed", "app.test.second"],
        ),
        (
            vec!["app.test.allowed", "app.test.second"],
            None,
            vec!["app.test.allowed", "app.test.second"],
        ),
    ] {
        let mut context = test_context(42);
        context.permissions = granted.into_iter().map(str::to_owned).collect();
        let expected_checks = &checked;
        let result = ready(execute(&context, "app_test_multiple", |state| async move {
            assert!(missing.is_none(), "缺任一权限时不可执行用例");
            assert_eq!(&*state.checked.lock().unwrap(), expected_checks);
            Ok(state.value)
        }));
        if let Some(key) = missing {
            let error = result.unwrap_err();
            assert_eq!(error.code, "app.permission.denied");
            assert_eq!(
                error.params,
                BTreeMap::from([("permission".into(), key.into())])
            );
        } else {
            assert_eq!(result.unwrap(), 42);
        }
        assert_eq!(*context.checked.lock().unwrap(), checked);
        assert_eq!(
            context.resolved.load(std::sync::atomic::Ordering::Relaxed),
            1
        );
    }
}

#[test]
fn required_permission_is_checked_after_identity_and_before_use_case() {
    let _guard = IPC_TEST_LOCK.lock().unwrap();
    let context = test_context(42);
    let error = ready(execute(&context, "app_test_denied", |_| async {
        must_not_run("无权限时不可执行用例")
    }))
    .unwrap_err();
    assert_eq!(error.code, "app.permission.denied");
    assert_eq!(error.params["permission"], "app.test.denied");
    assert_eq!(
        ready(execute(&context, "app_test_allowed", |state| async move {
            Ok(state.value)
        }))
        .unwrap(),
        42
    );
    let error = ready(execute(&context, "disabled_test_denied", |_| async {
        Ok(())
    }))
    .unwrap_err();
    assert_eq!(error.code, "app.module.disabled");
    assert_eq!(
        context.resolved.load(std::sync::atomic::Ordering::Relaxed),
        2
    );
}

#[test]
fn session_and_public_entries_guard_first_and_select_their_resolver() {
    let _guard = IPC_TEST_LOCK.lock().unwrap();
    let context = test_context(7);
    let session = ready(execute_session(&context, "disabled_test", |_| async {
        must_not_run("guard")
    }))
    .unwrap_err();
    let public = ready(execute_public(&context, "disabled_test", |_| async {
        must_not_run("guard")
    }))
    .unwrap_err();
    assert_eq!(session.code, "app.module.disabled");
    assert_eq!(public.code, "app.module.disabled");
    assert_eq!(
        context.resolved.load(std::sync::atomic::Ordering::Relaxed),
        0
    );
    let actor = ready(execute_session(
        &context,
        "app_session",
        |invocation| async move { Ok(invocation.execution.actor) },
    ))
    .unwrap();
    assert_eq!(actor, Actor::User(context.actor));
    assert_eq!(
        context.resolved.load(std::sync::atomic::Ordering::Relaxed),
        10
    );
    let (actor, trace, value) = ready(execute_public(
        &context,
        "app_public",
        |invocation| async move {
            Ok((
                invocation.actor,
                invocation.trace_id.clone(),
                invocation.value,
            ))
        },
    ))
    .unwrap();
    assert_eq!(actor, None);
    assert_eq!(value, 7);
    assert_eq!(Uuid::parse_str(&trace).unwrap().get_version_num(), 7);
    assert_eq!(
        context.resolved.load(std::sync::atomic::Ordering::Relaxed),
        110
    );
    ready(execute(&context, "app_active", |_| async { Ok(()) })).unwrap();
    assert_eq!(
        context.resolved.load(std::sync::atomic::Ordering::Relaxed),
        111
    );
}

#[test]
fn module_guard_runs_before_identity_and_use_case_but_allows_host_commands() {
    let _guard = IPC_TEST_LOCK.lock().unwrap();
    let context = test_context(0);
    let error = ready(execute(&context, "disabled_user_get", |_| async {
        must_not_run("禁用模块不能进入用例")
    }))
    .unwrap_err();
    assert_eq!(error.code, "app.module.disabled");
    assert_eq!(error.params["module"], "disabled");
    assert_eq!(
        context.resolved.load(std::sync::atomic::Ordering::Relaxed),
        0
    );
    let execution = ready(execute(
        &context,
        "app_unregistered_command",
        |invocation| async move { Ok(invocation.execution) },
    ))
    .unwrap();
    assert_eq!(execution.actor, Actor::User(context.actor));
    assert_eq!(
        Uuid::parse_str(&execution.trace_id)
            .unwrap()
            .get_version_num(),
        7
    );
    let error = ready(execute(
        &context,
        "app_any_command",
        |invocation| async move {
            Err::<(), _>(
                AppError::new(INPUT_INVALID).with_param("trace", invocation.execution.trace_id),
            )
        },
    ))
    .unwrap_err();
    assert_eq!(error.trace_id, error.params["trace"]);
}
