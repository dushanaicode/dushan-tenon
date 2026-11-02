use super::*;

#[tokio::test]
async fn measure_and_attachment_are_real() {
    test_support::run(async |test| {
        let f = Fixture::new(test).await;
        let mut selected = Vec::new();
        for index in 0..6 { selected.push(f.create(&format!("measure-{index}"), "汉🙂e\u{301}").await); }
        f.service.started().unwrap().params.set(&f.actor, "demo.batch_size", "2", None).await.unwrap();
        let job = f.service.measure_start(&f.queue, &f.actor, DemoMeasureInput { samples: selected.iter().map(version).collect() }).await.unwrap();
        assert!(!f.queue.get(job.job_id).await.unwrap().payload.to_string().contains('汉'));
        let cancellation = CancellationToken::new();
        let signal = cancellation.clone();
        let progress = Arc::new(Mutex::new(Vec::new()));
        let observed = progress.clone();
        let context = f.queue.test_context_with_progress_observer(job.job_id, cancellation, move |current| {
            observed.lock().unwrap().push(current);
            if current == 2 { signal.cancel(); }
        }).await.unwrap();
        assert_eq!(f.handler("demo.measure").run(context).await.unwrap_err().code(), JOB_CANCELLED);
        assert_eq!(*progress.lock().unwrap(), [2]);
        assert_eq!(f.service.overview_get(&f.actor).await.unwrap().ready, 2);
        assert_eq!(f.get(selected[0].id).await.character_count, Some(4));
        let pending = f.service.measure_start(&f.queue, &f.actor, DemoMeasureInput { samples: selected[2..].iter().map(version).collect() }).await.unwrap();
        f.preferences.lock().unwrap().developer_mode = false;
        assert_eq!(f.service.sample_get(&f.actor, DemoSampleId { id: selected[0].id }).await.unwrap_err().code(), MODE_DISABLED);
        assert_eq!(f.run(pending.job_id).await.unwrap()["processed"], 4);
        f.preferences.lock().unwrap().developer_mode = true;
        let current = f.get(selected[0].id).await;
        let stale = f.service.measure_start(&f.queue, &f.actor, DemoMeasureInput { samples: vec![version(&current)] }).await.unwrap();
        f.service.sample_update(&f.actor, DemoSampleUpdate { id: current.id, row_version: current.row_version, title: "changed".into(), note: "changed".into() }).await.unwrap();
        assert_eq!(f.run(stale.job_id).await.unwrap_err().code(), DATA_VERSION_CONFLICT);
        assert!(f.service.measure_start(&f.queue, &f.actor, DemoMeasureInput { samples: vec![] }).await.is_err());
        let sample = f.create("attachment", "").await;
        let other = f.other();
        let input = test.root.path().join("attachment.txt");
        fs::write(&input, b"attachment bytes").unwrap();
        assert_eq!(f.service.attachment_add(&other, DemoSampleVersion { id: sample.id, row_version: 1 }, &input).await.unwrap_err().code(), SAMPLE_NOT_FOUND);
        let added = f.service.attachment_add(&f.actor, DemoSampleVersion { id: sample.id, row_version: 1 }, &input).await.unwrap();
        assert_eq!(added.attachment.as_ref().unwrap().bytes, 16);
        assert!(!added.attachment.as_ref().unwrap().missing);
        assert_eq!(f.service.attachment_add(&f.actor, DemoSampleVersion { id: sample.id, row_version: added.row_version }, &input).await.unwrap_err().code(), ATTACHMENT_EXISTS);
        assert_eq!(f.service.attachment_preview(&other, DemoSampleId { id: sample.id }).await.unwrap_err().code(), SAMPLE_NOT_FOUND);
        assert!(matches!(f.service.attachment_preview(&f.actor, DemoSampleId { id: sample.id }).await.unwrap(), FilePreview::Text { text, .. } if text == "attachment bytes"));
        let saved = test.root.path().join("saved.txt");
        f.service.attachment_save(&f.actor, DemoSampleId { id: sample.id }, &saved).await.unwrap();
        assert_eq!(fs::read(saved).unwrap(), b"attachment bytes");
        assert_eq!(f.service.attachment_remove(&f.actor, version(&sample)).await.unwrap_err().code(), DATA_VERSION_CONFLICT);
        let removed = f.service.attachment_remove(&f.actor, version(&added)).await.unwrap();
        assert!(removed.attachment.is_none());
        let files = &f.service.started().unwrap().files;
        assert_eq!(files.list(FileListInput { pagination: tenon_framework::db::PageRequest { page: 1, page_size: 100 }, purpose: Some("demo.attachment".into()), keyword: None }).await.unwrap().total, 0);
        // 文件登记触发并发版本变化；绑定失败后补偿移除刚登记的新文件。
        let trigger = match test.db.dialect() {
            Dialect::Sqlite => format!("CREATE TRIGGER demo_bump AFTER INSERT ON fw_file BEGIN UPDATE demo_sample SET row_version = row_version + 1 WHERE id = '{}'; END", sample.id),
            Dialect::Mysql => format!("CREATE TRIGGER demo_bump AFTER INSERT ON fw_file FOR EACH ROW UPDATE demo_sample SET row_version = row_version + 1 WHERE id = '{}'", sample.id),
            Dialect::Postgres => format!("CREATE FUNCTION demo_bump_fn() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN UPDATE demo_sample SET row_version = row_version + 1 WHERE id = '{}'; RETURN NEW; END $$; CREATE TRIGGER demo_bump AFTER INSERT ON fw_file FOR EACH ROW EXECUTE FUNCTION demo_bump_fn()", sample.id),
        };
        test.raw(&trigger).await;
        assert_eq!(f.service.attachment_add(&f.actor, DemoSampleVersion { id: sample.id, row_version: removed.row_version }, &input).await.unwrap_err().code(), DATA_VERSION_CONFLICT);
        assert!(f.get(sample.id).await.attachment.is_none());
        assert!(test.rows::<(Id,)>("fw_file", &["id"]).await.is_empty());
        assert_eq!(jobs::require_permissions(&f.service.account, &other, jobs::PERMISSIONS).await.unwrap_err().code(), PERMISSION_DENIED);
        f.registry.stop().await.unwrap();
    }).await;
}
