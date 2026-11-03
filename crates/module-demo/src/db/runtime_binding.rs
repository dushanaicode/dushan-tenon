use super::*;
use tenon_framework::{
    job::{JobRunner, JobStatus, JobsConfig},
    maintenance::OperationGate,
    module::RegistryError,
};

#[tokio::test]
async fn exchange_requires_host_handlers_and_disabled_demo_binds_none() {
    test_support::run(async |test| {
        let f = Fixture::new(test).await;
        assert_eq!(f.service.clone().extensions().job_handlers.iter().map(|h| h.kind()).collect::<Vec<_>>(), ["demo.measure"]);
        assert!(matches!(f.registry.freeze(vec![]), Err(RegistryError::InvalidJob { module, .. }) if module == "demo"));
        let mut duplicate = host_handlers(f.service.clone(), f.paths.clone());
        duplicate.push(duplicate[0].clone());
        assert!(matches!(f.registry.freeze(duplicate), Err(RegistryError::InvalidJob { module, .. }) if module == "demo"));
        for kind in ["demo.sample_import", "demo.sample_export"] {
            let handler = f.handler(kind);
            assert!(handler.local_only());
            assert!(!handler.retry_safe());
            assert_eq!(handler.max_attempts(), 1);
        }
        let disabled = ModuleRegistry::new(
            vec![f.service.account.clone(), f.service.clone()],
            &BTreeMap::from([("demo".into(), false)]),
        ).unwrap();
        let frozen = disabled.freeze(host_handlers(f.service.clone(), f.paths.clone())).unwrap();
        assert!(frozen.job_handlers().is_empty());
        assert!(disabled.migrations().iter().any(|m| m.info.module == "demo"));
        f.registry.stop().await.unwrap();
    }).await;
}

#[tokio::test]
async fn exchange_rechecks_permissions_before_consuming_a_path_or_accessing_files() {
    test_support::run(async |test| {
        let f = Fixture::new(test).await;
        let path = test.root.path().join("not-readable.json");
        let export = f
            .export(
                &path,
                ExchangeFormat::Json,
                DemoExportOptions {
                    keyword: None,
                    stage: None,
                },
            )
            .await
            .unwrap();
        let import = f
            .import(&path, ExchangeFormat::Json, DemoImportMode::Error)
            .await
            .unwrap();
        for (id, kind, permission) in [
            (import.job_id, "demo.sample_import", "demo.sample.write"),
            (export.job_id, "demo.sample_export", "demo.sample.read"),
        ] {
            let mut context = f
                .queue
                .test_context(id, CancellationToken::new())
                .await
                .unwrap();
            context.execution = f.other();
            let error = if kind == "demo.sample_import" {
                f.service
                    .run_import(
                        &context,
                        &path,
                        ExchangeFormat::Json,
                        &DemoImportOptions {
                            mode: DemoImportMode::Error,
                        },
                        Language::ZhCn,
                    )
                    .await
                    .unwrap_err()
            } else {
                f.service
                    .run_export(
                        &context,
                        &path,
                        ExchangeFormat::Json,
                        &DemoExportOptions {
                            keyword: None,
                            stage: None,
                        },
                        Language::ZhCn,
                    )
                    .await
                    .unwrap_err()
            };
            assert_eq!(error.code(), PERMISSION_DENIED);
            assert_eq!(error.params()["permission"], permission);
            let error = f.handler(kind).run(context).await.unwrap_err();
            assert_eq!(error.code(), PERMISSION_DENIED);
            assert_eq!(error.params()["permission"], permission);
            assert!(f.paths.lock().unwrap().contains_key(&id));
        }
        assert!(!path.exists());
        f.registry.stop().await.unwrap();
    })
    .await;
}

#[tokio::test]
async fn host_exchange_adapter_runs_through_the_job_runner() {
    test_support::run(async |test| {
        let f = Fixture::new(test).await;
        f.create("runner", "only my row").await;
        let path = test.root.path().join("runner.json");
        let job = f
            .export(
                &path,
                ExchangeFormat::Json,
                DemoExportOptions {
                    keyword: None,
                    stage: None,
                },
            )
            .await
            .unwrap();
        f.preferences.lock().unwrap().developer_mode = false;
        let runner = JobRunner::start(
            f.queue.clone(),
            f.extensions.identity().permission_lookup.clone(),
            JobsConfig::new(1, 10).unwrap(),
            OperationGate::default(),
        )
        .await
        .unwrap();
        let result = tokio::time::timeout(std::time::Duration::from_secs(5), async {
            loop {
                let result = f.queue.get(job.job_id).await.unwrap();
                if result.status.is_terminal() {
                    break result;
                }
                tokio::time::sleep(std::time::Duration::from_millis(10)).await;
            }
        })
        .await
        .unwrap();
        runner.stop().await.unwrap();
        assert_eq!(result.status, JobStatus::Succeeded);
        assert_eq!(result.result.unwrap()["rows"], 1);
        assert!(fs::read_to_string(path).unwrap().contains("only my row"));
        assert!(f.paths.lock().unwrap().is_empty());
        f.registry.stop().await.unwrap();
    })
    .await;
}
