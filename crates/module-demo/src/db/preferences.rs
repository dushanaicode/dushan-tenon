use super::*;
use std::sync::atomic::{AtomicUsize, Ordering};

#[tokio::test]
async fn every_user_use_case_reads_live_mode_and_propagates_preference_failure() {
    test_support::run(async |test| {
        let f = Fixture::new(test).await;
        let sample = f.create("gate", "note").await;
        let draft = f
            .service
            .draft_open(&f.actor, DemoDraftOpen { sample_id: None })
            .await
            .unwrap();
        let path = test.root.path().join("unused.txt");
        f.preferences.lock().unwrap().developer_mode = false;
        for expected in [MODE_DISABLED, INTERNAL_UNEXPECTED] {
            if expected == INTERNAL_UNEXPECTED {
                f.preferences.lock().unwrap().developer_mode = true;
                assert_eq!(f.get(sample.id).await.code, "gate");
                let preferences = f.preferences.clone();
                assert!(
                    std::thread::spawn(move || {
                        let _guard = preferences.lock().unwrap();
                        panic!("poison the test preferences port");
                    })
                    .join()
                    .is_err()
                );
            }
            macro_rules! rejected {
                ($result:expr) => {
                    assert_eq!(
                        $result.err().expect("user entry must reject").code(),
                        expected
                    );
                };
            }
            rejected!(f.service.overview_get(&f.actor).await);
            rejected!(
                f.service
                    .sample_list(
                        &f.actor,
                        DemoListInput {
                            page: 1,
                            page_size: 10,
                            keyword: None,
                            stage: None
                        }
                    )
                    .await
            );
            rejected!(
                f.service
                    .sample_get(&f.actor, DemoSampleId { id: sample.id })
                    .await
            );
            rejected!(
                f.service
                    .sample_create(
                        &f.actor,
                        DemoSampleCreate {
                            code: "blocked".into(),
                            title: "blocked".into(),
                            note: String::new()
                        }
                    )
                    .await
            );
            rejected!(
                f.service
                    .sample_update(
                        &f.actor,
                        DemoSampleUpdate {
                            id: sample.id,
                            row_version: 1,
                            title: "blocked".into(),
                            note: String::new()
                        }
                    )
                    .await
            );
            rejected!(f.service.sample_delete(&f.actor, version(&sample)).await);
            rejected!(
                f.service
                    .draft_open(&f.actor, DemoDraftOpen { sample_id: None })
                    .await
            );
            rejected!(
                f.service
                    .draft_write(
                        &f.actor,
                        DemoDraftWrite {
                            lease: draft.lease.clone(),
                            fields: draft.fields.clone()
                        }
                    )
                    .await
            );
            rejected!(f.service.draft_discard(&f.actor, draft.lease.clone()).await);
            rejected!(f.service.draft_commit(&f.actor, draft.lease.clone()).await);
            rejected!(
                f.service
                    .attachment_add(&f.actor, version(&sample), &path)
                    .await
            );
            rejected!(
                f.service
                    .attachment_preview(&f.actor, DemoSampleId { id: sample.id })
                    .await
            );
            rejected!(
                f.service
                    .attachment_save(&f.actor, DemoSampleId { id: sample.id }, &path)
                    .await
            );
            rejected!(
                f.service
                    .attachment_remove(&f.actor, version(&sample))
                    .await
            );
            rejected!(
                f.service
                    .measure_start(
                        &f.queue,
                        &f.actor,
                        DemoMeasureInput {
                            samples: vec![version(&sample)]
                        }
                    )
                    .await
            );
            rejected!(f.service.prepare_export(
                &f.actor,
                &DemoExportOptions {
                    keyword: None,
                    stage: None
                }
            ));
            rejected!(f.service.prepare_import(&f.actor));
        }
        assert_eq!(test.rows::<(Id,)>("demo_sample", &["id"]).await.len(), 1);
        f.registry.stop().await.unwrap();
    })
    .await;
}

#[tokio::test]
async fn exchange_preparation_captures_one_snapshot_and_checks_owner_and_filter() {
    test_support::run(async |test| {
        let f = Fixture::new(test).await;
        let reads = Arc::new(AtomicUsize::new(0));
        let observed = reads.clone();
        let service = DemoService::new(
            f.service.account.clone(),
            Arc::new(move || {
                Ok(DemoPreferences {
                    developer_mode: observed.fetch_add(1, Ordering::SeqCst) == 0,
                    language: Language::EnUs,
                })
            }),
        );
        let options = DemoExportOptions {
            keyword: None,
            stage: None,
        };
        assert_eq!(
            service.prepare_export(&f.actor, &options).unwrap(),
            Language::EnUs
        );
        assert_eq!(reads.load(Ordering::SeqCst), 1);
        assert_eq!(
            service.prepare_import(&f.actor).unwrap_err().code(),
            MODE_DISABLED
        );
        assert_eq!(reads.load(Ordering::SeqCst), 2);
        let system = ExecutionContext::new(Actor::System, "system");
        assert_eq!(
            f.service.prepare_import(&system).unwrap_err().code(),
            INTERNAL_UNEXPECTED
        );
        assert_eq!(
            f.service
                .prepare_export(&system, &options)
                .unwrap_err()
                .code(),
            INTERNAL_UNEXPECTED
        );
        for keyword in ["x".repeat(121), "nul\0".into()] {
            assert_eq!(
                f.service
                    .prepare_export(
                        &f.actor,
                        &DemoExportOptions {
                            keyword: Some(keyword),
                            stage: None
                        }
                    )
                    .unwrap_err()
                    .code(),
                INPUT_INVALID
            );
        }
        f.registry.stop().await.unwrap();
    })
    .await;
}

struct LanguageTranslator;
impl Translator for LanguageTranslator {
    fn text(&self, key: &str, params: &serde_json::Map<String, Value>) -> Result<String, AppError> {
        self.text_in(Language::ZhCn, key, params)
    }
    fn text_in(
        &self,
        language: Language,
        key: &str,
        _: &serde_json::Map<String, Value>,
    ) -> Result<String, AppError> {
        Ok(format!(
            "{}-{key}",
            match language {
                Language::ZhCn => "zh",
                Language::EnUs => "en",
            }
        ))
    }
}

#[tokio::test]
async fn submitted_exchange_keeps_language_and_continues_after_mode_is_disabled() {
    test_support::run(async |test| {
        let f = Fixture::with_translator(test, Arc::new(LanguageTranslator)).await;
        let sample = f.create("language", "private note").await;
        f.preferences.lock().unwrap().language = Language::EnUs;
        let path = test.root.path().join("language.csv");
        let export = f
            .export(
                &path,
                ExchangeFormat::Csv,
                DemoExportOptions {
                    keyword: None,
                    stage: None,
                },
            )
            .await
            .unwrap();
        let payload = f.queue.get(export.job_id).await.unwrap().payload;
        assert_eq!(payload["language"], "en-US");
        assert!(!payload.to_string().contains(path.to_str().unwrap()));
        *f.preferences.lock().unwrap() = DemoPreferences {
            developer_mode: false,
            language: Language::ZhCn,
        };
        assert_eq!(f.run(export.job_id).await.unwrap()["rows"], 1);
        let csv = fs::read_to_string(&path).unwrap();
        assert!(csv.contains("en-demo.sample.title"));
        assert!(csv.contains("en-dict.demo.sample_stage.draft"));
        assert!(!csv.contains("zh-demo.sample.title"));

        *f.preferences.lock().unwrap() = DemoPreferences {
            developer_mode: true,
            language: Language::EnUs,
        };
        f.service
            .sample_delete(&f.actor, version(&sample))
            .await
            .unwrap();
        let import = f
            .import(&path, ExchangeFormat::Csv, DemoImportMode::Error)
            .await
            .unwrap();
        assert_eq!(
            f.queue.get(import.job_id).await.unwrap().payload["language"],
            "en-US"
        );
        *f.preferences.lock().unwrap() = DemoPreferences {
            developer_mode: false,
            language: Language::ZhCn,
        };
        assert_eq!(f.run(import.job_id).await.unwrap()["created"], 1);
        let rows = test.rows::<(String,)>("demo_sample", &["code"]).await;
        assert_eq!(rows, [("language".to_owned(),)]);
        assert!(f.paths.lock().unwrap().is_empty());
        f.registry.stop().await.unwrap();
    })
    .await;
}
