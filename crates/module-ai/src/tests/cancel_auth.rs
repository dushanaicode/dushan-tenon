use super::*;

#[tokio::test]
async fn authorization_is_rechecked_after_proxy_snapshot_and_before_http_send() {
    struct RevokeOnStart {
        permissions: Arc<Permissions>,
        events: Events,
    }
    impl StreamSink<AiStreamData> for RevokeOnStart {
        fn send(&self, event: StreamEvent<AiStreamData>) -> Result<(), AppError> {
            if matches!(
                &event,
                StreamEvent::Delta {
                    data: AiStreamData {
                        update: AiUpdate::MessageStart { .. },
                        ..
                    },
                    ..
                }
            ) {
                self.permissions.0.store(1, Ordering::SeqCst);
            }
            self.events.send(event)
        }
    }
    test_support::run(async |test| {
        let mut fixture = Fixture::new(test).await;
        let server = Server::sse(complete()).await;
        fixture.configure(&server).await;
        Arc::get_mut(&mut fixture.ai).unwrap().proxy = Arc::new({
            let permissions = fixture.permissions.clone();
            move |_| {
                permissions.0.store(1, Ordering::SeqCst);
                Ok(ProxySnapshot::Direct)
            }
        });
        let events = Events::default();
        assert_eq!(error_code(fixture.chat(&events).await), PERMISSION_DENIED);
        assert!(events.values().is_empty());

        fixture.permissions.0.store(0, Ordering::SeqCst);
        Arc::get_mut(&mut fixture.ai).unwrap().proxy = Arc::new(|_| Ok(ProxySnapshot::Direct));
        let sink = RevokeOnStart {
            permissions: fixture.permissions.clone(),
            events: events.clone(),
        };
        assert_eq!(
            error_code(
                fixture
                    .ai
                    .chat(
                        &fixture.actor,
                        "main",
                        input(),
                        &StreamRegistry::default(),
                        sink
                    )
                    .await
            ),
            PERMISSION_DENIED
        );
        assert_eq!(events.terminal()["code"], PERMISSION_DENIED.as_str());
        assert!(server.requests.lock().unwrap().is_empty());
        assert!(fixture.ai.runs.lock().unwrap().entries.is_empty());
        server.stop().await;
    })
    .await;
}

#[tokio::test]
async fn cancellation_requires_both_actor_and_scope() {
    test_support::run(async |test| {
        let fixture = Fixture::new(test).await;
        let run_id = Id::new();
        let registration = fixture.ai.register(&fixture.actor, "main", run_id).unwrap();
        for owner in [
            StreamOwner {
                actor: Actor::User(Id::new()),
                scope: "main".into(),
            },
            StreamOwner {
                actor: fixture.actor.actor,
                scope: "other-window".into(),
            },
        ] {
            assert_eq!(
                error_code(fixture.ai.cancel(&owner, AiCancelInput { run_id })),
                STREAM_FORBIDDEN
            );
            assert!(!registration.cancellation.is_cancelled());
        }
        fixture
            .ai
            .cancel(&fixture.owner(), AiCancelInput { run_id })
            .unwrap();
        assert!(registration.cancellation.is_cancelled());
        drop(registration);
        fixture
            .ai
            .cancel(&fixture.owner(), AiCancelInput { run_id })
            .unwrap();
    })
    .await;
}

#[tokio::test]
async fn ai_cancel_waits_for_request_release() {
    test_support::run(async |test| {
        let fixture = Fixture::new(test).await;
        let server = Server::new(
            200,
            "Content-Type: text/event-stream\r\n",
            vec![
                Step::Bytes(chunk(json!({"content":"partial"}), Value::Null).into_bytes()),
                Step::Wait(Duration::from_secs(60)),
            ],
            true,
        )
        .await;
        fixture.configure(&server).await;
        let input = input();
        let run_id = input.run_id;
        let events = Events::default();
        let task = fixture.spawn(input, StreamRegistry::default(), events.clone());
        server.received(1).await;
        fixture
            .ai
            .cancel(&fixture.owner(), AiCancelInput { run_id })
            .unwrap();
        assert!(!events.values().iter().any(|e| e["type"] == "cancelled"));
        assert_eq!(error_code(task.await.unwrap()), CANCELLED);
        server.released(1).await;
        assert_eq!(events.terminal()["type"], "cancelled");
        assert_eq!(
            events
                .values()
                .iter()
                .filter(|e| e["type"] == "cancelled")
                .count(),
            1
        );
        assert!(fixture.ai.runs.lock().unwrap().entries.is_empty());
        server.stop().await;
    })
    .await;
}

#[tokio::test]
async fn other_subject_is_rejected_without_an_account_row() {
    test_support::run(async |test| {
        let fixture = Fixture::new(test).await;
        let other = Actor::User(Id::new());
        assert_eq!(
            fixture
                .ai
                .authorize(fixture.ai.started.get().unwrap(), other, false)
                .await
                .unwrap_err()
                .code(),
            AUTH_REQUIRED
        );
        assert_eq!(
            fixture
                .ai
                .active(other, || -> Result<(), AppError> {
                    panic!("other subject must not receive delivery")
                })
                .await
                .unwrap_err()
                .code(),
            AUTH_REQUIRED
        );
        fixture
            .ai
            .authorize(
                fixture.ai.started.get().unwrap(),
                fixture.actor.actor,
                false,
            )
            .await
            .unwrap();
    })
    .await;
}

#[tokio::test]
async fn ai_auth_change_stops_delivery() {
    test_support::run(async |test| {
        let fixture = Fixture::new(test).await;
        let server = Server::new(
            200,
            "Content-Type: text/event-stream\r\n",
            vec![
                Step::Wait(Duration::from_secs(60)),
                Step::Bytes(complete().into_bytes()),
            ],
            true,
        )
        .await;
        fixture.configure(&server).await;
        for (permission_state, code) in [(1, PERMISSION_DENIED), (2, INTERNAL_UNEXPECTED)] {
            fixture.permissions.0.store(0, Ordering::SeqCst);
            let events = Events::default();
            let task = fixture.spawn(input(), StreamRegistry::default(), events.clone());
            let count = permission_state as usize;
            server.received(count).await;
            fixture
                .permissions
                .0
                .store(permission_state, Ordering::SeqCst);
            assert_eq!(error_code(task.await.unwrap()), code);
            server.released(count).await;
            assert!(
                !events
                    .values()
                    .iter()
                    .any(|e| e["data"]["update"]["type"] == "textDelta")
            );
        }
        fixture.permissions.0.store(0, Ordering::SeqCst);
        fixture
            .account
            .enable_login(&fixture.actor, "synthetic-password".into())
            .await
            .unwrap();
        let task = fixture.spawn(input(), StreamRegistry::default(), Events::default());
        server.received(3).await;
        fixture.account.lock().await.unwrap();
        assert_eq!(error_code(task.await.unwrap()), AUTH_REQUIRED);
        server.released(3).await;
        fixture
            .account
            .login(tenon_module_account::LoginInput {
                password: "synthetic-password".into(),
                captcha: None,
            })
            .await
            .unwrap();
        let events = Events::default();
        let task = fixture.spawn(input(), StreamRegistry::default(), events.clone());
        server.received(4).await;
        fixture.account.logout(&fixture.actor).await.unwrap();
        assert_eq!(error_code(task.await.unwrap()), AUTH_REQUIRED);
        server.released(4).await;
        assert!(
            !events
                .values()
                .iter()
                .any(|event| event["data"]["update"]["type"] == "textDelta")
        );
        server.stop().await;
    })
    .await;
}

#[tokio::test]
async fn ai_cancel_after_revocation_and_unknown_is_final() {
    test_support::run(async |test| {
        let fixture = Fixture::new(test).await;
        let server = Server::new(
            200,
            "Content-Type: text/event-stream\r\n",
            vec![Step::Wait(Duration::from_secs(60))],
            true,
        )
        .await;
        fixture.configure(&server).await;
        let request = input();
        let run_id = request.run_id;
        let task = fixture.spawn(request, StreamRegistry::default(), Events::default());
        server.received(1).await;
        let mut duplicate = input();
        duplicate.run_id = run_id;
        assert_eq!(
            error_code(
                fixture
                    .ai
                    .chat(
                        &fixture.actor,
                        "main",
                        duplicate,
                        &StreamRegistry::default(),
                        Events::default()
                    )
                    .await
            ),
            CONFLICT
        );
        fixture.permissions.0.store(1, Ordering::SeqCst);
        fixture
            .ai
            .cancel(&fixture.owner(), AiCancelInput { run_id })
            .unwrap();
        assert_eq!(error_code(task.await.unwrap()), CANCELLED);
        server.released(1).await;
        server.stop().await;
        fixture.permissions.0.store(0, Ordering::SeqCst);
        struct CancelOnText {
            ai: Arc<AiService>,
            owner: StreamOwner,
            run_id: Id,
            events: Events,
        }
        impl StreamSink<AiStreamData> for CancelOnText {
            fn send(&self, event: StreamEvent<AiStreamData>) -> Result<(), AppError> {
                if matches!(
                    &event,
                    StreamEvent::Delta {
                        data: AiStreamData {
                            update: AiUpdate::TextDelta { .. },
                            ..
                        },
                        ..
                    }
                ) {
                    self.ai.cancel(
                        &self.owner,
                        AiCancelInput {
                            run_id: self.run_id,
                        },
                    )?;
                }
                self.events.send(event)
            }
        }
        let server = Server::sse(chunk(json!({"content":"buffered"}), Value::Null)).await;
        fixture.configure(&server).await;
        let request = input();
        let events = Events::default();
        let sink = CancelOnText {
            ai: fixture.ai.clone(),
            owner: fixture.owner(),
            run_id: request.run_id,
            events: events.clone(),
        };
        assert_eq!(
            error_code(
                fixture
                    .ai
                    .chat(
                        &fixture.actor,
                        "main",
                        request,
                        &StreamRegistry::default(),
                        sink
                    )
                    .await
            ),
            RESULT_UNKNOWN
        );
        assert_eq!(events.terminal()["type"], "unknown");
        server.stop().await;
    })
    .await;
}
