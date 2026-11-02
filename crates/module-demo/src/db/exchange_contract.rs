use super::*;

#[tokio::test]
async fn exchange_is_atomic_and_filtered() {
    test_support::run(async |test| {
        let f = Fixture::new(test).await;
        for index in 0..105 { f.create(&format!("item-{index:03}"), "private note 汉字").await; }
        f.service.sample_create(&f.actor, DemoSampleCreate { code: "excluded".into(), title: "excluded".into(), note: "".into() }).await.unwrap();
        let other = f.other();
        f.service.sample_create(&other, DemoSampleCreate { code: "foreign".into(), title: "match foreign".into(), note: "FOREIGN_SENTINEL".into() }).await.unwrap();
        let spec = exchange::dataset();
        let translator = TestTranslator;
        let resolver = exchange::Resolver(&translator);
        for format in [ExchangeFormat::Json, ExchangeFormat::Csv, ExchangeFormat::Xlsx] {
            let first = f.list(Some("match")).await.items.remove(0);
            let job = f.service.measure_start(&f.queue, &f.actor, DemoMeasureInput { samples: vec![version(&first)] }).await.unwrap();
            f.run(job.job_id).await.unwrap();
            let path = test.root.path().join(format!("export.{}", format.extension()));
            let job = f.export(&path, format, DemoExportOptions { keyword: Some("match".into()), stage: None }).await.unwrap();
            let payload = f.queue.get(job.job_id).await.unwrap().payload.to_string();
            assert!(!payload.contains("private note"));
            assert!(!payload.contains("export."));
            assert_eq!(f.run(job.job_id).await.unwrap()["rows"], 105);
            let exchange = Exchange { dataset: &spec, format, language: Language::ZhCn, translator: &translator, dictionaries: &resolver };
            let rows = exchange.read(&fs::read(&path).unwrap()).unwrap();
            assert_eq!(rows.len(), 105);
            assert!(rows.iter().all(|(_, row)| row.keys().map(String::as_str).collect::<Vec<_>>() == ["code", "note", "stage", "title"]));
            assert!(!serde_json::to_string(&rows).unwrap().contains("FOREIGN_SENTINEL"));
            while f.list(Some("match")).await.total > 0 {
                for sample in f.list(Some("match")).await.items { f.service.sample_delete(&f.actor, version(&sample)).await.unwrap(); }
            }
            for (mode, expected_created, expected_skipped) in [(DemoImportMode::Error, 105, 0), (DemoImportMode::Skip, 0, 105)] {
                let job = f.import(&path, format, mode).await.unwrap();
                let report = f.run(job.job_id).await.unwrap();
                assert_eq!(report["created"], expected_created);
                assert_eq!(report["skipped"], expected_skipped);
            }
            assert_eq!(f.service.overview_get(&f.actor).await.unwrap().ready, 0);
            let duplicate = f.import(&path, format, DemoImportMode::Error).await.unwrap();
            assert_eq!(f.run(duplicate.job_id).await.unwrap_err().code(), tenon_framework::exchange::ROWS_INVALID);
            assert_eq!(f.list(None).await.total, 106);
            let invalid_rows = [
                BTreeMap::from([("code".into(), json!("valid-first")), ("title".into(), json!("new")), ("note".into(), json!("")), ("stage".into(), json!("ready"))]),
                BTreeMap::from([("code".into(), json!("invalid-second")), ("title".into(), json!("")), ("note".into(), json!("")), ("stage".into(), json!("draft"))]),
            ];
            let invalid = test.root.path().join(format!("invalid.{}", format.extension()));
            fs::write(&invalid, exchange.write(&invalid_rows, &CancellationToken::new()).unwrap()).unwrap();
            let job = f.import(&invalid, format, DemoImportMode::Skip).await.unwrap();
            assert_eq!(f.run(job.job_id).await.unwrap_err().code(), tenon_framework::exchange::ROWS_INVALID);
            assert_eq!(f.list(Some("valid-first")).await.total, 0);
        }
        // 完整校验通过后，第二条实际写入失败，第一条也必须回滚。
        let trigger: String = match test.db.dialect() {
            Dialect::Sqlite => "CREATE TRIGGER demo_reject BEFORE INSERT ON demo_sample WHEN NEW.code = 'blocked' BEGIN SELECT RAISE(ABORT, 'demo rollback'); END".into(),
            Dialect::Mysql => "CREATE TRIGGER demo_reject BEFORE INSERT ON demo_sample FOR EACH ROW BEGIN IF NEW.code = 'blocked' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'demo rollback'; END IF; END".into(),
            Dialect::Postgres => "CREATE FUNCTION demo_reject_fn() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.code = 'blocked' THEN RAISE EXCEPTION 'demo rollback'; END IF; RETURN NEW; END $$; CREATE TRIGGER demo_reject BEFORE INSERT ON demo_sample FOR EACH ROW EXECUTE FUNCTION demo_reject_fn()".into(),
        };
        test.raw(&trigger).await;
        let exchange = Exchange { dataset: &spec, format: ExchangeFormat::Json, language: Language::ZhCn, translator: &translator, dictionaries: &resolver };
        let rows = ["rollback-good", "blocked"].map(|code| BTreeMap::from([("code".into(), json!(code)), ("title".into(), json!("rollback")), ("note".into(), json!("")), ("stage".into(), json!("draft"))]));
        let path = test.root.path().join("rollback.json");
        fs::write(&path, exchange.write(&rows, &CancellationToken::new()).unwrap()).unwrap();
        let job = f.import(&path, ExchangeFormat::Json, DemoImportMode::Error).await.unwrap();
        assert!(f.run(job.job_id).await.is_err());
        assert_eq!(f.list(Some("rollback")).await.total, 0);
        f.registry.stop().await.unwrap();
    }).await;
}
