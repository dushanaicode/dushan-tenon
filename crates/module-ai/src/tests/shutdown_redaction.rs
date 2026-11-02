use super::*;

#[tokio::test]
async fn poisoned_registry_rejects_work_but_cancels_and_releases_registrations() {
    test_support::run(async |test| {
        let fixture = Fixture::new(test).await;
        let mut first = fixture
            .ai
            .register(&fixture.actor, "main", Id::new())
            .unwrap();
        let second = fixture
            .ai
            .register(&fixture.actor, "main", Id::new())
            .unwrap();
        assert!(
            std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                let _guard = fixture.ai.runs.lock().unwrap();
                panic!("poison synthetic run registry");
            }))
            .is_err()
        );
        assert_eq!(
            fixture
                .ai
                .register(&fixture.actor, "main", Id::new())
                .err()
                .unwrap()
                .code(),
            INTERNAL_UNEXPECTED
        );
        assert_eq!(
            error_code(
                fixture
                    .ai
                    .cancel(&fixture.owner(), AiCancelInput { run_id: first.id })
            ),
            INTERNAL_UNEXPECTED
        );
        assert_eq!(error_code(fixture.ai.stop().await), INTERNAL_UNEXPECTED);
        assert!(first.cancellation.is_cancelled());
        assert!(second.cancellation.is_cancelled());
        assert_eq!(error_code(first.release()), INTERNAL_UNEXPECTED);
        drop(first);
        drop(second);
        let runs = fixture.ai.runs.lock().err().unwrap().into_inner();
        assert!(runs.closed);
        assert!(runs.entries.is_empty());
    })
    .await;
}

#[tokio::test]
async fn poisoned_registry_at_completion_reports_failure_after_releasing_http() {
    struct PoisonOnPartEnd {
        ai: Arc<AiService>,
        events: Events,
    }
    impl StreamSink<AiStreamData> for PoisonOnPartEnd {
        fn send(&self, event: StreamEvent<AiStreamData>) -> Result<(), AppError> {
            if matches!(
                &event,
                StreamEvent::Delta {
                    data: AiStreamData {
                        update: AiUpdate::PartEnd { .. },
                        ..
                    },
                    ..
                }
            ) {
                assert!(
                    std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                        let _guard = self.ai.runs.lock().unwrap();
                        panic!("poison synthetic completion registry");
                    }))
                    .is_err()
                );
            }
            self.events.send(event)
        }
    }
    test_support::run(async |test| {
        let fixture = Fixture::new(test).await;
        let server = Server::sse(complete()).await;
        fixture.configure(&server).await;
        let events = Events::default();
        let sink = PoisonOnPartEnd {
            ai: fixture.ai.clone(),
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
            INTERNAL_UNEXPECTED
        );
        server.released(1).await;
        assert_eq!(events.terminal()["type"], "failed");
        assert_eq!(events.terminal()["code"], INTERNAL_UNEXPECTED.as_str());
        assert!(
            fixture
                .ai
                .runs
                .lock()
                .err()
                .unwrap()
                .into_inner()
                .entries
                .is_empty()
        );
        server.stop().await;
    })
    .await;
}

#[tokio::test]
async fn ai_observer_loss_and_shutdown_release() {
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
        let streams = StreamRegistry::default();
        let first = fixture.spawn(input(), streams.clone(), Events::default());
        let second = fixture.spawn(input(), StreamRegistry::default(), Events::default());
        server.received(2).await;
        assert_eq!(error_code(fixture.chat(&Events::default()).await), BUSY);
        assert_eq!(
            fixture
                .ai
                .test_connection(&fixture.actor)
                .await
                .err()
                .unwrap()
                .code(),
            BUSY
        );
        streams.cancel_scope("main").unwrap();
        assert_eq!(error_code(first.await.unwrap()), CANCELLED);
        let abandoned = fixture.spawn(input(), StreamRegistry::default(), Events::default());
        server.received(3).await;
        abandoned.abort();
        assert!(abandoned.await.unwrap_err().is_cancelled());
        server.released(2).await;
        fixture.ai.stop().await.unwrap();
        assert_eq!(error_code(second.await.unwrap()), CANCELLED);
        server.released(3).await;
        assert_eq!(
            error_code(fixture.chat(&Events::default()).await),
            STREAM_CLOSED
        );
        server.stop().await;
    })
    .await;
}

#[tokio::test]
async fn ai_preparing_shutdown_and_sink_loss() {
    test_support::run(async |test| {
        let fixture = Fixture::new(test).await;
        let server = Server::sse(complete()).await;
        fixture.configure(&server).await;
        struct Lost;
        impl StreamSink<AiStreamData> for Lost {
            fn send(&self, event: StreamEvent<AiStreamData>) -> Result<(), AppError> {
                if matches!(event, StreamEvent::Delta { .. }) {
                    Err(AppError::new(INTERNAL_UNEXPECTED))
                } else {
                    Ok(())
                }
            }
        }
        assert_eq!(
            error_code(
                fixture
                    .ai
                    .chat(
                        &fixture.actor,
                        "main",
                        input(),
                        &StreamRegistry::default(),
                        Lost
                    )
                    .await
            ),
            RESULT_UNKNOWN
        );
        assert!(fixture.ai.runs.lock().unwrap().entries.is_empty());
        fixture.permissions.0.store(3, Ordering::SeqCst);
        let task = fixture.spawn(input(), StreamRegistry::default(), Events::default());
        tokio::task::yield_now().await;
        assert_eq!(fixture.ai.runs.lock().unwrap().entries.len(), 1);
        fixture.ai.stop().await.unwrap();
        assert_eq!(error_code(task.await.unwrap()), CANCELLED);
        server.stop().await;
    })
    .await;
}

#[tokio::test]
async fn ai_lifecycle_logs_only_safe_metadata() {
    // tracing 的 callsite interest 是进程级缓存；日志捕获与其他并行测试隔离。
    if std::env::var_os("TENON_TEST_AI_LOG_CAPTURE").is_none() {
        let output = child_test(concat!(
            module_path!(),
            "::ai_lifecycle_logs_only_safe_metadata"
        ))
        .env("TENON_TEST_AI_LOG_CAPTURE", "1")
        .output()
        .unwrap();
        assert_child_passed(&output);
        return;
    }
    #[derive(Clone, Default)]
    struct Logs(Arc<Mutex<Vec<u8>>>);
    impl std::io::Write for Logs {
        fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
            self.0.lock().unwrap().extend_from_slice(bytes);
            Ok(bytes.len())
        }
        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }
    test_support::run(async |test| {
        let fixture = Fixture::new(test).await;
        let server = Server::sse(format!(
            "{}data: [DONE]\n\n",
            chunk(
                json!({
                    "content":"reply-sentinel", "reasoning_content":"reasoning-sentinel"
                }),
                json!("stop")
            )
        ))
        .await;
        fixture.configure(&server).await;
        fixture
            .set("ai.base_url", &format!("{}/path-sentinel", server.url))
            .await;
        fixture.set("ai.api_key", "key-sentinel").await;
        let logs = Logs::default();
        let writer = logs.clone();
        let subscriber = tracing_subscriber::fmt()
            .json()
            .with_ansi(false)
            .with_max_level(tracing::Level::TRACE)
            .with_writer(move || writer.clone())
            .finish();
        let _subscriber = tracing::subscriber::set_default(subscriber);
        let mut request = input();
        request.messages[0].parts = vec![AiPart::Text {
            part_id: Id::new(),
            text: "prompt-sentinel".into(),
        }];
        fixture
            .ai
            .chat(
                &fixture.actor,
                "main",
                request,
                &StreamRegistry::default(),
                Events::default(),
            )
            .await
            .unwrap();
        let closed = StreamRegistry::default();
        closed.close().unwrap();
        assert_eq!(
            error_code(
                fixture
                    .ai
                    .chat(&fixture.actor, "main", input(), &closed, Events::default())
                    .await
            ),
            STREAM_CLOSED
        );
        struct Lost;
        impl StreamSink<AiStreamData> for Lost {
            fn send(&self, _: StreamEvent<AiStreamData>) -> Result<(), AppError> {
                Err(AppError::new(INTERNAL_UNEXPECTED))
            }
        }
        assert_eq!(
            error_code(
                fixture
                    .ai
                    .chat(
                        &fixture.actor,
                        "main",
                        input(),
                        &StreamRegistry::default(),
                        Lost
                    )
                    .await
            ),
            RESULT_UNKNOWN
        );
        let recorded = String::from_utf8(logs.0.lock().unwrap().clone()).unwrap();
        for secret in [
            "prompt-sentinel",
            "reply-sentinel",
            "reasoning-sentinel",
            "key-sentinel",
            "path-sentinel",
        ] {
            assert!(!recorded.contains(secret));
        }
        let records: Vec<Value> = recorded
            .lines()
            .map(|line| serde_json::from_str(line).unwrap())
            .filter(|record: &Value| record["fields"]["event"] == "ai.stream.ended")
            .collect();
        assert_eq!(records.len(), 3);
        assert_eq!(
            records
                .iter()
                .map(|record| record["fields"]["terminal"].as_str().unwrap())
                .collect::<Vec<_>>(),
            ["succeeded", "failed", "unknown"]
        );
        assert_eq!(records[0]["fields"]["model"], "synthetic/model");
        assert!(records[0]["fields"]["input_bytes"].as_u64().unwrap() > 0);
        assert!(records[0]["fields"]["output_bytes"].as_u64().unwrap() > 0);
        server.stop().await;
    })
    .await;
}
