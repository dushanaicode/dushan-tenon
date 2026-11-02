use super::*;
use rustls::pki_types::{CertificateDer, pem::PemObject};

#[tokio::test]
async fn proxy_port_is_lazy_and_reads_one_snapshot_per_request() {
    test_support::run(async |test| {
        let mut fixture = Fixture::new(test).await;
        let calls = Arc::new(Mutex::new(Vec::new()));
        let proxy: Arc<dyn Fn(bool) -> Result<ProxySnapshot, AppError> + Send + Sync> = Arc::new({
            let calls = calls.clone();
            move |exact_loopback| {
                calls.lock().unwrap().push(exact_loopback);
                if exact_loopback {
                    Ok(ProxySnapshot::Direct)
                } else {
                    Err(AppError::new(tenon_framework::network::CREDENTIALS_MISSING))
                }
            }
        });
        let unstarted = AiService::new(fixture.account.clone(), proxy.clone());
        assert!(calls.lock().unwrap().is_empty());
        drop(unstarted);
        Arc::get_mut(&mut fixture.ai).unwrap().proxy = proxy;
        let server = Server::sse(complete()).await;
        fixture.configure(&server).await;
        fixture.chat(&Events::default()).await.unwrap();
        fixture.ai.test_connection(&fixture.actor).await.unwrap();
        fixture.set("ai.base_url", "https://127.0.0.2:1/v1").await;
        let events = Events::default();
        assert_eq!(
            error_code(fixture.chat(&events).await),
            tenon_framework::network::CREDENTIALS_MISSING
        );
        assert!(events.values().is_empty());
        assert!(fixture.ai.runs.lock().unwrap().entries.is_empty());
        assert_eq!(*calls.lock().unwrap(), [true, true, false]);
        assert_eq!(server.requests.lock().unwrap().len(), 2);
        server.stop().await;
    })
    .await;
}

#[tokio::test]
async fn poisoned_proxy_port_returns_internal_error_before_sending() {
    test_support::run(async |test| {
        let fixture = Fixture::new(test).await;
        let server = Server::sse(complete()).await;
        fixture.configure(&server).await;
        assert!(
            std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                let _guard = fixture.proxy_config.lock().unwrap();
                panic!("poison synthetic proxy settings");
            }))
            .is_err()
        );
        let events = Events::default();
        assert_eq!(error_code(fixture.chat(&events).await), INTERNAL_UNEXPECTED);
        assert!(events.values().is_empty());
        assert!(server.requests.lock().unwrap().is_empty());
        assert!(fixture.ai.runs.lock().unwrap().entries.is_empty());
        server.stop().await;
    })
    .await;
}

#[tokio::test]
async fn restore_requires_new_ai_endpoint_and_credentials() {
    use tenon_framework::backup::{self, Cancellation, restore};
    test_support::run(async |test| {
        let fixture = Fixture::new(test).await;
        fixture
            .set("ai.base_url", "https://collector.invalid/v1")
            .await;
        fixture.set("ai.model", "synthetic-model").await;
        fixture.set("ai.api_key", "source-key").await;
        let migrations = ModuleRegistry::new(
            vec![fixture.account.clone(), fixture.ai.clone()],
            &Default::default(),
        )
        .unwrap()
        .migrations();
        let output = std::path::PathBuf::from(std::env::var_os("TEMP").expect("isolated TEMP"))
            .join(format!("restore-ai-{}", Id::new()));
        std::fs::create_dir(&output).unwrap();
        let archive = output.join("ai.tenon-backup.zip");
        let files = file_store(test, 20, &[]).unwrap();
        let instance = files.instance_id();
        backup::export(
            backup::BackupInput {
                db: test.db.clone(),
                files,
                state_root: test.root.path().to_owned(),
                scratch: output.join("export"),
                destination: archive.clone(),
                config_projection: br#"{"schema_version":1}"#.to_vec(),
                product_id: "fixture".into(),
                app_version: "0.1.0".into(),
                migrations: migrations.clone(),
            },
            Arc::new(Cancellation::default()),
            Arc::new(|_, _, _| {}),
        )
        .await
        .unwrap();
        let operation = output.join("restore");
        std::fs::create_dir(&operation).unwrap();
        let cancellation = Arc::new(Cancellation::default());
        let (manifest, _) =
            restore::extract(&archive, &operation, "fixture", &cancellation).unwrap();
        let stage = operation.join("stage");
        let budget = restore::DatabaseBudget::new(cancellation, restore::DATABASE_TIMEOUT);
        restore::prepare_database(&stage, &manifest, &migrations, instance, &budget)
            .await
            .unwrap();
        let db = restore::open_sqlite(stage.join("data/app.db"), budget)
            .await
            .unwrap();
        AiService::unbind_restored_credentials(&db).await.unwrap();
        // 模拟重启后的新缓存与目标机器已有的内存凭据，不能继承来源端点的授权。
        let secrets =
            SecretStore::with_backend(test.root.path(), MemoryCredentials::default()).unwrap();
        secrets
            .set(
                "param.ai.api_key",
                &secrecy::SecretString::from("target-key"),
            )
            .unwrap();
        let cache = Cache::connect(&cache_config(), &secrets).await.unwrap();
        let params = ParamStore::new(
            db.clone(),
            cache,
            secrets,
            &[("ai", DECLARATION.permissions, DECLARATION.params)],
        )
        .unwrap();
        assert_eq!(params.text("ai.base_url").await.unwrap(), "");
        assert!(params.secret("ai.api_key").await.unwrap().is_none());
        assert_eq!(
            Config::read(&params, false).await.err().unwrap().code(),
            NOT_CONFIGURED
        );
        assert_eq!(
            Config::read(&params, true).await.err().unwrap().code(),
            NOT_CONFIGURED
        );
        db.close().await;
    })
    .await;
}

#[test]
fn ai_roots_ignore_unparsable_certificates() {
    let valid = CertificateDer::from_pem_slice(ROOT_CERT_PEM).unwrap();
    let garbage = CertificateDer::from(b"unparsable-certificate-sentinel".as_slice());
    let (roots, ignored) =
        client::roots_from_der([garbage.clone(), valid, garbage.clone()]).unwrap();
    assert_eq!(roots.len(), 1);
    assert_eq!(ignored, 2);
    for certs in [vec![garbage], vec![]] {
        assert_eq!(
            client::roots_from_der(certs).unwrap_err().code(),
            CONNECT_FAILED
        );
    }
}

#[tokio::test]
async fn ai_module_start_does_not_load_roots() {
    if std::env::var_os("TENON_TEST_AI_ROOTS_CHILD").is_none() {
        let directory = std::env::temp_dir().join(format!("ai-roots-{}", Id::new()));
        std::fs::create_dir(&directory).unwrap();
        let output = child_test(concat!(
            module_path!(),
            "::ai_module_start_does_not_load_roots"
        ))
        .arg("--nocapture")
        .env("TENON_TEST_AI_ROOTS_CHILD", "1")
        .env("SSL_CERT_FILE", directory.join("roots.pem"))
        .env_remove("SSL_CERT_DIR")
        .output()
        .unwrap();
        assert_child_passed(&output);
        std::fs::remove_dir(&directory).unwrap();
        return;
    }
    // 固定子进程环境，仅改变 PEM 文件，不在多线程测试进程中 set_var。
    let path = std::path::PathBuf::from(std::env::var_os("SSL_CERT_FILE").unwrap());
    assert!(!path.exists());
    assert!(rustls_native_certs::load_native_certs().certs.is_empty());
    test_support::run(async |test| {
        let fixture = Fixture::new(test).await;
        let server = Server::sse(complete()).await;
        fixture.configure(&server).await;
        let events = Events::default();
        assert_eq!(error_code(fixture.chat(&events).await), CONNECT_FAILED);
        assert_eq!(events.terminal()["type"], "failed");
        assert_eq!(events.terminal()["code"], CONNECT_FAILED.as_str());
        assert_eq!(
            fixture
                .ai
                .test_connection(&fixture.actor)
                .await
                .err()
                .unwrap()
                .code(),
            CONNECT_FAILED
        );
        assert!(server.requests.lock().unwrap().is_empty());
        assert!(fixture.ai.runs.lock().unwrap().entries.is_empty());

        std::fs::write(&path, ROOT_CERT_PEM).unwrap();
        fixture.ai.test_connection(&fixture.actor).await.unwrap();
        // 成功后即使证书文件消失，聊天仍复用 TLS；不同超时会重建 reqwest Client。
        std::fs::remove_file(&path).unwrap();
        fixture.chat(&Events::default()).await.unwrap();
        fixture.chat(&Events::default()).await.unwrap();
        assert_eq!(server.requests.lock().unwrap().len(), 3);
        server.stop().await;
    })
    .await;
}

#[test]
fn ai_url_and_authorization_policy() {
    for url in [
        "https://example.test/prefix/v1/",
        "http://localhost:1234/v1",
        "http://127.0.0.1/v1",
        "http://[::1]/prefix",
    ] {
        assert!(client::endpoint(url).is_ok());
    }
    for url in [
        "http://example.test",
        "http://localhost.evil",
        "http://127.1",
        "http://2130706433",
        "http://0x7f000001",
        "http://127.0.0.2",
        "http://localhost.",
        "https://user@host",
        "https://@host",
        "https://host?x",
        "https://host#",
        "https://host:0",
        "https://host\\x",
        " https://host",
        "https://host\nx",
        "/v1",
    ] {
        assert!(client::endpoint(url).is_err(), "{url}");
    }
    assert_eq!(
        client::endpoint("https://example.test/proxy/v1/")
            .unwrap()
            .path(),
        "/proxy/v1/chat/completions"
    );
    assert!(client::authorization("fake-key").unwrap().is_sensitive());
    for key in ["", "bad\r\nx", "bad\tvalue"] {
        assert!(client::authorization(key).is_err());
    }
}

#[tokio::test]
async fn ai_saved_config_and_secret_boundary() {
    test_support::run(async |test| {
        let fixture = Fixture::new(test).await;
        let server = Server::new(
            200,
            "Content-Type: text/event-stream\r\n",
            vec![
                Step::Wait(Duration::from_millis(80)),
                Step::Bytes(complete().into_bytes()),
            ],
            true,
        )
        .await;
        fixture.configure(&server).await;
        fixture.set("ai.api_key", "secret-key-sentinel").await;
        let events = Events::default();
        let task = fixture.spawn(input(), StreamRegistry::default(), events.clone());
        server.received(1).await;
        fixture.set("ai.model", "next-model").await;
        fixture.set("ai.include_usage", "false").await;
        task.await.unwrap().unwrap();
        assert_eq!(
            events.values()[1]["data"]["update"]["model"],
            "synthetic/model"
        );
        fixture.chat(&Events::default()).await.unwrap();
        {
            let requests = server.requests.lock().unwrap();
            assert_eq!(
                requests[0].headers["authorization"],
                "Bearer secret-key-sentinel"
            );
            assert_eq!(requests[0].body["model"], "synthetic/model");
            assert_eq!(requests[1].body["model"], "next-model");
            assert!(requests[1].body.get("stream_options").is_none());
        }
        let entry = fixture
            .params
            .entries()
            .await
            .unwrap()
            .into_iter()
            .find(|e| e.key == "ai.api_key")
            .unwrap();
        assert!(entry.secret_set && entry.value.is_none() && entry.default.is_none());
        assert!(
            !serde_json::to_string(&events.values())
                .unwrap()
                .contains("secret-key-sentinel")
        );
        let secrets =
            SecretStore::with_backend(test.root.path(), MemoryCredentials::default()).unwrap();
        let cache = Cache::connect(&cache_config(), &secrets).await.unwrap();
        let missing = ParamStore::new(
            test.db.clone(),
            cache,
            secrets,
            &[("ai", DECLARATION.permissions, DECLARATION.params)],
        )
        .unwrap();
        assert_eq!(
            missing.secret("ai.api_key").await.err().unwrap().code(),
            tenon_framework::secret::SECRET_NOT_FOUND
        );
        fixture
            .params
            .reset("ai.api_key", entry.row_version)
            .await
            .unwrap();
        assert!(fixture.params.secret("ai.api_key").await.unwrap().is_none());
        server.stop().await;
    })
    .await;
}

#[tokio::test]
async fn ai_environment_secret_requires_marker() {
    let output = child_test(concat!(module_path!(), "::unmarked_secret_child"))
        .env(
            "TENON_SECRET__PARAM__AI__API_KEY",
            "synthetic-environment-sentinel",
        )
        .output()
        .unwrap();
    assert_child_passed(&output);
}

#[tokio::test]
async fn unmarked_secret_child() {
    test_support::run(async |test| {
        let fixture = Fixture::new(test).await;
        let server = Server::sse(complete()).await;
        fixture.configure(&server).await;
        fixture.chat(&Events::default()).await.unwrap();
        assert!(
            !server.requests.lock().unwrap()[0]
                .headers
                .contains_key("authorization")
        );
        server.stop().await;
    })
    .await;
}

#[tokio::test]
async fn ai_manual_proxy_without_environment_fallback() {
    use secrecy::SecretString;
    use tenon_framework::network::CREDENTIALS_KEY;
    use tokio::net::TcpListener;
    if std::env::var_os("TENON_TEST_AI_PROXY_CHILD").is_none() {
        let sentinel = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let endpoint = format!("http://{}", sentinel.local_addr().unwrap());
        let output = tokio::task::spawn_blocking(move || {
            child_test(concat!(
                module_path!(),
                "::ai_manual_proxy_without_environment_fallback"
            ))
            .env("TENON_TEST_AI_PROXY_CHILD", "1")
            .env("HTTP_PROXY", &endpoint)
            .env("HTTPS_PROXY", &endpoint)
            .env("ALL_PROXY", &endpoint)
            .env("NO_PROXY", "")
            .output()
            .unwrap()
        })
        .await
        .unwrap();
        assert_child_passed(&output);
        assert!(
            timeout(Duration::from_millis(50), sentinel.accept())
                .await
                .is_err()
        );
        return;
    }
    #[derive(Clone, Default)]
    struct ProxyLogs(Arc<Mutex<Vec<u8>>>);
    impl std::io::Write for ProxyLogs {
        fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
            self.0.lock().unwrap().extend_from_slice(bytes);
            Ok(bytes.len())
        }
        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }
    let logs = ProxyLogs::default();
    let writer = logs.clone();
    let _subscriber = tracing::subscriber::set_default(
        tracing_subscriber::fmt()
            .with_ansi(false)
            .with_max_level(tracing::Level::TRACE)
            .with_writer(move || writer.clone())
            .finish(),
    );
    test_support::run(async |test| {
        let fixture = Fixture::new(test).await;
        let direct = Server::sse(format!(
            "{}data: [DONE]\n\n",
            chunk(json!({"content":"OK"}), json!("stop"))
        ))
        .await;
        fixture.configure(&direct).await;
        fixture.ai.test_connection(&fixture.actor).await.unwrap();
        assert_eq!(direct.requests.lock().unwrap().len(), 1);

        // 精确 localhost 在 manual 且凭据缺失时仍直连，不访问代理或秘密。
        let (old_endpoint, old_proxy) = crate::test_support::rejecting_proxy().await;
        *fixture.proxy_config.lock().unwrap() =
            ProxyConfig::new(ProxyMode::Manual, old_endpoint.clone(), true).unwrap();
        fixture
            .set("ai.base_url", &direct.url.replace("127.0.0.1", "localhost"))
            .await;
        fixture.ai.test_connection(&fixture.actor).await.unwrap();
        assert_eq!(direct.requests.lock().unwrap().len(), 2);
        assert!(!old_proxy.is_finished());
        assert!(
            !direct.requests.lock().unwrap()[1]
                .headers
                .contains_key("proxy-authorization")
        );

        // 非精确回环目标用本机 .2 监听作零请求哨兵，不触达公网。
        let target = TcpListener::bind("127.0.0.2:0").await.unwrap();
        fixture
            .set(
                "ai.base_url",
                &format!("https://{}/v1", target.local_addr().unwrap()),
            )
            .await;
        fixture
            .proxy_secrets
            .set(
                CREDENTIALS_KEY,
                &SecretString::from(
                    r#"{"username":"proxy-user-sentinel","password":"proxy-password-sentinel"}"#,
                ),
            )
            .unwrap();
        fixture.set("ai.api_key", "target-key-sentinel").await;
        let config = Config::read(&fixture.params, true).await.unwrap();
        let snapshot = (fixture.ai.proxy)(config.exact_loopback).unwrap();
        let request = fixture
            .ai
            .started
            .get()
            .unwrap()
            .client
            .request(
                &config,
                &snapshot,
                client::body(&config, client::messages(&input().messages).unwrap(), true).unwrap(),
            )
            .unwrap();
        let (new_endpoint, new_proxy) = crate::test_support::rejecting_proxy().await;
        *fixture.proxy_config.lock().unwrap() =
            ProxyConfig::new(ProxyMode::Manual, new_endpoint.clone(), true).unwrap();
        // 已准备的请求仍用旧快照；下一请求用新值。两者失败都不连接目标。
        assert!(request.send().await.is_err());
        let old_headers = old_proxy.await.unwrap().to_ascii_lowercase();
        assert!(old_headers.starts_with("connect 127.0.0.2:"));
        assert!(old_headers.contains("\r\nproxy-authorization: basic "));
        assert!(!old_headers.contains("target-key-sentinel"));
        assert!(!old_headers.contains("\r\nauthorization:"));
        assert_eq!(
            fixture
                .ai
                .test_connection(&fixture.actor)
                .await
                .err()
                .unwrap()
                .code(),
            CONNECT_FAILED
        );
        let new_headers = new_proxy.await.unwrap().to_ascii_lowercase();
        assert!(new_headers.starts_with("connect 127.0.0.2:"));
        assert!(!new_headers.contains("target-key-sentinel"));
        assert!(
            timeout(Duration::from_millis(50), target.accept())
                .await
                .is_err()
        );
        let recorded = String::from_utf8(logs.0.lock().unwrap().clone()).unwrap();
        for secret in [
            "proxy-user-sentinel",
            "proxy-password-sentinel",
            "target-key-sentinel",
            &old_endpoint,
            &new_endpoint,
        ] {
            assert!(!recorded.contains(secret));
        }
        direct.stop().await;
    })
    .await;
}
