use super::*;

#[tokio::test]
async fn ai_stream_text_reasoning_and_finish() {
    test_support::run(async |test| {
        let fixture = Fixture::new(test).await;
        for reason in ["stop", "length"] {
            let data = format!(
                "{}{}{}data: [DONE]\n\ninvalid ignored",
                chunk(
                    json!({"role":"assistant", "content":"正文", "reasoning_content":"推理"}),
                    Value::Null
                ),
                chunk(json!({"reasoning_content":"继续推理"}), Value::Null),
                chunk(json!({"content":"尾文"}), json!(reason))
            );
            let server = Server::sse(data).await;
            fixture.configure(&server).await;
            let events = Events::default();
            fixture.chat(&events).await.unwrap();
            let values = events.values();
            assert_eq!(values[0]["type"], "started");
            let deltas: Vec<_> = values.iter().filter(|v| v["type"] == "delta").collect();
            for (seq, event) in deltas.iter().enumerate() {
                assert_eq!(event["seq"], seq);
            }
            let updates: Vec<_> = deltas.iter().map(|v| &v["data"]["update"]).collect();
            assert_eq!(updates[0]["type"], "messageStart");
            assert_eq!(
                updates
                    .iter()
                    .filter(|v| v["type"] == "partStart")
                    .map(|v| v["kind"].as_str().unwrap())
                    .collect::<Vec<_>>(),
                ["reasoning", "text", "reasoning", "text"]
            );
            assert_eq!(
                updates
                    .iter()
                    .filter_map(|v| v["text"].as_str())
                    .collect::<String>(),
                "推理正文继续推理尾文"
            );
            assert_eq!(events.terminal()["data"]["update"]["finishReason"], reason);
            assert!(events.terminal()["data"]["update"]["usage"].is_null());
            server.stop().await;
        }
    })
    .await;
}

#[tokio::test]
async fn ai_usage_is_nullable_snapshot() {
    test_support::run(async |test| {
        let fixture = Fixture::new(test).await;
        let first = json!({"prompt_tokens":10,"completion_tokens":4,"total_tokens":14,"completion_tokens_details":{"reasoning_tokens":2},"prompt_tokens_details":{"cached_tokens":3}});
        let data = format!("{}data: {}\n\ndata: {}\n\ndata: {}\n\ndata: {}\n\ndata: [DONE]\n\n", chunk(json!({}), json!("stop")), json!({"choices":[],"usage":first}), json!({"choices":[],"usage":first}), json!({"choices":[],"usage":{"completion_tokens":0}}), json!({"choices":[],"usage":null}));
        let server = Server::sse(data).await; fixture.configure(&server).await;
        let events = Events::default(); fixture.chat(&events).await.unwrap();
        let usages: Vec<_> = events.values().into_iter().filter(|v| v["data"]["update"]["type"] == "usage").collect();
        assert_eq!(usages.len(), 3);
        assert_eq!(usages[0]["data"]["update"]["usage"], usages[1]["data"]["update"]["usage"]);
        assert_eq!(events.terminal()["data"]["update"]["usage"], json!({"input":null,"output":0,"totalTokens":null,"reasoning":null,"cacheRead":null}));
        server.stop().await;
    }).await;
}

#[tokio::test]
async fn ai_incomplete_and_malformed_streams() {
    test_support::run(async |test| {
        let fixture = Fixture::new(test).await;
        for (data, code, reason) in [
            (
                chunk(json!({"content":"partial"}), json!("stop")),
                RESULT_UNKNOWN,
                Some("ai.stream.missingDone"),
            ),
            (
                "data: [DONE]\n\n".into(),
                RESULT_UNKNOWN,
                Some("ai.stream.missingFinish"),
            ),
            (
                format!("{}data: [DONE]\n", chunk(json!({}), json!("stop"))),
                RESULT_UNKNOWN,
                Some("ai.stream.missingDone"),
            ),
            ("data: {broken}\n\n".into(), PROTOCOL, None),
            (chunk(json!({"content":5}), Value::Null), PROTOCOL, None),
            (
                chunk(json!({"reasoning_content":false}), Value::Null),
                PROTOCOL,
                None,
            ),
            (chunk(json!({"role":"user"}), Value::Null), PROTOCOL, None),
            (
                chunk(json!({"function_call":{"name":"unsupported"}}), Value::Null),
                UNSUPPORTED,
                None,
            ),
            (
                chunk(json!({"reasoning":"unsupported"}), Value::Null),
                UNSUPPORTED,
                None,
            ),
            (
                chunk(json!({"tool_calls":[{}]}), Value::Null),
                UNSUPPORTED,
                None,
            ),
            (
                chunk(json!({"reasoning_text":"unsupported"}), Value::Null),
                UNSUPPORTED,
                None,
            ),
            (chunk(json!({}), json!("new_reason")), UNSUPPORTED, None),
            (chunk(json!({}), json!("tool_calls")), UNSUPPORTED, None),
            (chunk(json!({}), json!("function_call")), UNSUPPORTED, None),
            (chunk(json!({}), json!("")), PROTOCOL, None),
            ("data:  [DONE]\n\n".into(), PROTOCOL, None),
            (
                format!(
                    "{}{}",
                    chunk(json!({}), json!("stop")),
                    chunk(json!({"content":"late"}), Value::Null)
                ),
                PROTOCOL,
                None,
            ),
            (
                format!(
                    "data: {}\n\n",
                    json!({"choices":[{"index":0,"delta":{}},{"index":1,"delta":{}}]})
                ),
                PROTOCOL,
                None,
            ),
            (
                format!(
                    "data: {}\n\n",
                    json!({"choices":[],"usage":{"prompt_tokens":1.5}})
                ),
                PROTOCOL,
                None,
            ),
            (
                format!(
                    "data: {}\n\n",
                    json!({"choices":[],"usage":{"prompt_tokens_details":false}})
                ),
                PROTOCOL,
                None,
            ),
            (chunk(json!({}), json!("content_filter")), FILTERED, None),
            ("event: other\ndata: {}\n\n".into(), PROTOCOL, None),
            (
                "event: error\ndata: secret-response-sentinel\n\n".into(),
                RESPONSE_REJECTED,
                None,
            ),
            (
                "data: {\"error\":{\"message\":\"secret-response-sentinel\"}}\n\n".into(),
                RESPONSE_REJECTED,
                None,
            ),
            (
                "data: {\"choices\":[],\"usage\":{\"total_tokens\":-1}}\n\n".into(),
                PROTOCOL,
                None,
            ),
            (
                "data: {\"choices\":[],\"usage\":{\"total_tokens\":9007199254740992}}\n\n".into(),
                PROTOCOL,
                None,
            ),
            (
                "data: {\"choices\":[{\"index\":1,\"delta\":{}}]}\n\n".into(),
                PROTOCOL,
                None,
            ),
        ] {
            let server = Server::sse(data).await;
            fixture.configure(&server).await;
            let events = Events::default();
            let error = fixture.chat(&events).await.err().unwrap();
            assert_eq!(error.code(), code);
            assert!(!format!("{error:?}").contains("sentinel"));
            assert!(
                !serde_json::to_string(&events.values())
                    .unwrap()
                    .contains("sentinel")
            );
            if let Some(reason) = reason {
                assert_eq!(events.terminal()["reason"], reason);
            } else {
                assert_eq!(events.terminal()["type"], "failed");
            }
            server.stop().await;
        }
        let server = Server::new(
            200,
            "Content-Type: text/event-stream\r\n",
            vec![Step::Bytes(
                chunk(json!({"content":"partial"}), Value::Null).into_bytes(),
            )],
            false,
        )
        .await;
        fixture.configure(&server).await;
        let events = Events::default();
        assert_eq!(error_code(fixture.chat(&events).await), RESULT_UNKNOWN);
        assert_eq!(events.terminal()["reason"], "ai.stream.interrupted");
        server.stop().await;
    })
    .await;
}

#[tokio::test]
async fn ai_http_statuses_and_sensitive_body() {
    test_support::run(async |test| {
        let fixture = Fixture::new(test).await;
        for (status, code) in [
            (401, AUTH_FAILED),
            (403, AUTH_FAILED),
            (429, RATE_LIMITED),
            (500, UNAVAILABLE),
            (503, UNAVAILABLE),
            (201, HTTP_REJECTED),
            (400, HTTP_REJECTED),
            (302, REDIRECT_REJECTED),
        ] {
            let server = Server::new(
                status,
                "Location: http://127.0.0.1:1/secret-location\r\n",
                vec![Step::Bytes(b"secret-body-sentinel".to_vec())],
                true,
            )
            .await;
            fixture.configure(&server).await;
            let events = Events::default();
            let error = fixture.chat(&events).await.err().unwrap();
            assert_eq!(error.code(), code);
            assert!(!format!("{error:?}").contains("secret"));
            assert!(
                !serde_json::to_string(&events.values())
                    .unwrap()
                    .contains("secret")
            );
            assert_eq!(server.requests.lock().unwrap().len(), 1);
            server.stop().await;
        }
    })
    .await;
}

#[tokio::test]
async fn ai_connection_test_uses_fixed_stream() {
    test_support::run(async |test| {
        let fixture = Fixture::new(test).await;
        let server = Server::sse(format!(
            "{}data: [DONE]\n\n",
            chunk(json!({}), json!("length"))
        ))
        .await;
        fixture.configure(&server).await;
        let result = fixture.ai.test_connection(&fixture.actor).await.unwrap();
        let result = serde_json::to_value(result).unwrap();
        assert_eq!(result.as_object().unwrap().len(), 3);
        assert!(result["usage"].is_null());
        {
            let requests = server.requests.lock().unwrap();
            let request = &requests[0];
            assert_eq!(request.path, "POST /v1/chat/completions HTTP/1.1");
            assert_eq!(
                request.body["messages"],
                json!([{"role":"user","content":"Reply OK."}])
            );
            assert_eq!(request.body["max_tokens"], 1);
            assert_eq!(request.body["stream"], true);
            assert_eq!(request.body["n"], 1);
            assert_eq!(
                request.body["stream_options"],
                json!({"include_usage":true})
            );
            assert!(!request.headers.contains_key("authorization"));
            assert_eq!(request.headers["accept-encoding"], "identity");
        }
        server.stop().await;
    })
    .await;
}

#[tokio::test]
async fn ai_request_and_response_limits() {
    test_support::run(async |test| {
        let fixture = Fixture::new(test).await;
        let server = Server::sse(complete()).await;
        fixture.configure(&server).await;
        let mut oversized = input();
        oversized.messages[0].parts = vec![AiPart::Text {
            part_id: Id::new(),
            text: "x".repeat(MAX_REQUEST_BYTES),
        }];
        let events = Events::default();
        assert_eq!(
            error_code(
                fixture
                    .ai
                    .chat(
                        &fixture.actor,
                        "main",
                        oversized,
                        &StreamRegistry::default(),
                        events.clone()
                    )
                    .await
            ),
            LIMIT
        );
        assert!(events.values().is_empty());
        assert!(server.requests.lock().unwrap().is_empty());
        let config = Config::read(&fixture.params, false).await.unwrap();
        let overhead = client::body(&config, client::messages(&input().messages).unwrap(), false)
            .unwrap()
            .len()
            - "synthetic prompt".len();
        let mut boundary = input();
        boundary.messages[0].parts = vec![AiPart::Text {
            part_id: Id::new(),
            text: "x".repeat(MAX_REQUEST_BYTES - overhead),
        }];
        assert_eq!(
            client::body(
                &config,
                client::messages(&boundary.messages).unwrap(),
                false
            )
            .unwrap()
            .len(),
            MAX_REQUEST_BYTES
        );
        server.stop().await;
        let ending = complete();
        let padding = MAX_RESPONSE_BYTES - ending.len();
        let comments = [
            b":\n\n".repeat(padding / 3),
            vec![b'\n'; padding % 3],
            ending.into_bytes(),
        ]
        .concat();
        let server = Server::sse(comments.clone()).await;
        fixture.configure(&server).await;
        fixture.chat(&Events::default()).await.unwrap();
        server.stop().await;
        let server = Server::sse([b"\n".to_vec(), comments].concat()).await;
        fixture.configure(&server).await;
        let events = Events::default();
        assert_eq!(error_code(fixture.chat(&events).await), LIMIT);
        assert_eq!(events.terminal()["type"], "failed");
        server.stop().await;
        for count in [MAX_STREAM_DELTAS - 1, MAX_STREAM_DELTAS] {
            let usage = "data: {\"choices\":[],\"usage\":{\"completion_tokens\":0}}\n\n";
            let data = format!(
                "{}{}data: [DONE]\n\n",
                usage.repeat(count),
                chunk(json!({}), json!("stop"))
            );
            let server = Server::sse(data).await;
            fixture.configure(&server).await;
            let events = Events::default();
            let result = fixture.chat(&events).await;
            if count == MAX_STREAM_DELTAS - 1 {
                result.unwrap();
            } else {
                assert_eq!(error_code(result), LIMIT);
            }
            assert_eq!(
                events
                    .values()
                    .iter()
                    .filter(|e| e["type"] == "delta")
                    .count(),
                MAX_STREAM_DELTAS
            );
            assert_eq!(
                events.terminal()["type"],
                if count == MAX_STREAM_DELTAS - 1 {
                    "succeeded"
                } else {
                    "failed"
                }
            );
            server.stop().await;
        }
        let server = Server::sse(vec![b'x'; MAX_SSE_EVENT_BYTES + 1]).await;
        fixture.configure(&server).await;
        assert_eq!(error_code(fixture.chat(&Events::default()).await), LIMIT);
        server.stop().await;
    })
    .await;
}

#[tokio::test]
async fn ai_timeouts_and_heartbeats() {
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
        fixture.set("ai.connect_timeout_seconds", "1").await;
        fixture.set("ai.idle_timeout_seconds", "1").await;
        fixture.set("ai.total_timeout_seconds", "5").await;
        let events = Events::default();
        assert_eq!(error_code(fixture.chat(&events).await), RESULT_UNKNOWN);
        assert_eq!(events.terminal()["reason"], "ai.stream.timeout");
        server.released(1).await;
        server.stop().await;
        let mut steps = Vec::new();
        for _ in 0..14 {
            steps.push(Step::Wait(Duration::from_millis(400)));
            steps.push(Step::Bytes(b":heartbeat\n\n".to_vec()));
        }
        let server = Server::new(200, "Content-Type: text/event-stream\r\n", steps, true).await;
        fixture.configure(&server).await;
        let started = Instant::now();
        assert_eq!(
            error_code(fixture.chat(&Events::default()).await),
            RESULT_UNKNOWN
        );
        assert!(started.elapsed() >= Duration::from_secs(4));
        assert!(started.elapsed() < Duration::from_secs(7));
        server.released(1).await;
        server.stop().await;
        let server = Server::new(0, "", vec![], false).await;
        // 分开期限：相同期限可能由 read timeout 先返回，无法证明发送阶段时应为 unknown。
        fixture.set("ai.idle_timeout_seconds", "3").await;
        fixture
            .set("ai.base_url", &server.url.replacen("http:", "https:", 1))
            .await;
        let events = Events::default();
        assert_eq!(error_code(fixture.chat(&events).await), TIMEOUT);
        assert_eq!(events.terminal()["type"], "failed");
        server.released(1).await;
        server.stop().await;
        fixture.permissions.0.store(3, Ordering::SeqCst);
        tokio::time::pause();
        assert_eq!(error_code(fixture.chat(&Events::default()).await), TIMEOUT);
        let registered = fixture
            .ai
            .register(&fixture.actor, "main", Id::new())
            .unwrap();
        assert_eq!(
            fixture.ai.stop().await.err().unwrap().code(),
            SHUTDOWN_TIMEOUT
        );
        drop(registered);
        tokio::time::resume();
    })
    .await;
}

#[test]
fn ai_input_projection_is_strict() {
    let messages = (0..=MAX_MESSAGES)
        .map(|_| input().messages.remove(0))
        .collect::<Vec<_>>();
    assert!(client::messages(&messages).is_err());
    let mut duplicate = input();
    duplicate.messages.push(duplicate.messages[0].clone());
    assert!(client::messages(&duplicate.messages).is_err());
    let mut parts = input();
    parts.messages[0].parts = (0..=MAX_PARTS_PER_MESSAGE)
        .map(|_| AiPart::Text {
            part_id: Id::new(),
            text: "x".into(),
        })
        .collect();
    assert!(client::messages(&parts.messages).is_err());
    let mut request = input();
    let first_id = request.messages[0].parts[0].clone();
    request.messages[0].parts.push(first_id);
    assert!(client::messages(&request.messages).is_err());
    let mut request = input();
    request.messages[0].role = AiRole::Assistant;
    assert!(client::messages(&request.messages).is_err());
    request.messages[0].role = AiRole::User;
    request.messages[0].parts.push(AiPart::Reasoning {
        part_id: Id::new(),
        text: "unreplayed".into(),
    });
    assert!(client::messages(&request.messages).is_err());
    request.messages[0].role = AiRole::Assistant;
    request.messages.push(input().messages.remove(0));
    let projected = serde_json::to_value(client::messages(&request.messages).unwrap()).unwrap();
    assert!(!projected.to_string().contains("unreplayed"));
    for value in [
        json!({"runId":Id::new(),"messages":[],"endpoint":"https://forbidden"}),
        json!({"runId":Id::new(),"messages":[{"id":Id::new(),"role":"user","parts":[{"type":"text","partId":Id::new(),"text":"x","secret":"injection"}]}]}),
    ] {
        assert!(serde_json::from_value::<AiChatInput>(value).is_err());
    }
}

#[tokio::test]
async fn ai_response_encoding_and_localhost() {
    test_support::run(async |test| {
        let fixture=Fixture::new(test).await;
        for headers in ["Content-Type: application/json\r\n", "Content-Type: text/event-stream\r\nContent-Encoding: gzip\r\n", "Content-Type: text/event-stream\r\nContent-Encoding: identity\r\nContent-Encoding: gzip\r\n"] {
            let server=Server::new(200,headers,vec![Step::Bytes(complete().into_bytes())],true).await;
            fixture.configure(&server).await;assert_eq!(error_code(fixture.chat(&Events::default()).await),PROTOCOL);server.stop().await;
        }
        let server=Server::new(200,"Content-Type: TEXT/EVENT-STREAM; charset=utf-8\r\n",vec![Step::Bytes(complete().into_bytes())],true).await;
        fixture.configure(&server).await;fixture.set("ai.base_url",&server.url.replace("127.0.0.1","localhost")).await;
        fixture.chat(&Events::default()).await.unwrap();server.stop().await;
    }).await;
}

#[tokio::test]
async fn ai_text_flush_and_finish_barriers() {
    test_support::run(async |test| {
        let fixture = Fixture::new(test).await;
        let server = Server::new(
            200,
            "Content-Type: text/event-stream\r\n",
            vec![
                Step::Bytes(chunk(json!({"content":"early text"}), Value::Null).into_bytes()),
                Step::Wait(Duration::from_secs(60)),
            ],
            true,
        )
        .await;
        fixture.configure(&server).await;
        let request = input();
        let run_id = request.run_id;
        let events = Events::default();
        let task = fixture.spawn(request, StreamRegistry::default(), events.clone());
        server.received(1).await;
        timeout(Duration::from_secs(1), async {
            while !events
                .values()
                .iter()
                .any(|e| e["data"]["update"]["type"] == "textDelta")
            {
                tokio::time::sleep(Duration::from_millis(5)).await;
            }
        })
        .await
        .unwrap();
        assert!(!task.is_finished());
        fixture
            .ai
            .cancel(&fixture.owner(), AiCancelInput { run_id })
            .unwrap();
        assert_eq!(error_code(task.await.unwrap()), CANCELLED);
        server.stop().await;
        let data = format!(
            "data: {}\n\ndata: [DONE]\n\n",
            json!({
                "choices":[{"index":0,"delta":{"content":"last text"},"finish_reason":"stop"}],
                "usage":{"completion_tokens":1}
            })
        );
        let server = Server::sse(data).await;
        fixture.configure(&server).await;
        let events = Events::default();
        fixture.chat(&events).await.unwrap();
        let values = events.values();
        assert_eq!(
            values
                .iter()
                .filter(|e| e["type"] == "delta")
                .map(|e| e["data"]["update"]["type"].as_str().unwrap())
                .collect::<Vec<_>>(),
            ["messageStart", "partStart", "textDelta", "usage", "partEnd"]
        );
        assert_eq!(events.terminal()["type"], "succeeded");
        server.stop().await;
    })
    .await;
}
