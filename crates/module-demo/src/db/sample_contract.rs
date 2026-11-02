use super::*;

#[tokio::test]
async fn sample_contract() {
    test_support::run(async |test| {
        let f = Fixture::new(test).await;
        assert_eq!(f.service.overview_get(&f.actor).await.unwrap().total, 0);
        let a = f.create("A", "汉字🙂e\u{301}").await;
        assert_eq!(a.stage, DemoSampleStage::Draft);
        assert_eq!(a.character_count, None);
        assert_eq!(a.row_version, 1);
        assert_eq!(
            f.service
                .sample_create(
                    &f.actor,
                    DemoSampleCreate {
                        code: "A".into(),
                        title: "second".into(),
                        note: "".into()
                    }
                )
                .await
                .unwrap_err()
                .code(),
            CODE_CONFLICT
        );
        let mut tx = test.db.begin().await.unwrap();
        assert!(
            samples::insert(
                &mut tx,
                user(&f.actor).unwrap(),
                &DemoSampleCreate {
                    code: "A".into(),
                    title: "raw duplicate".into(),
                    note: "".into()
                }
            )
            .await
            .is_err()
        );
        tx.rollback().await.unwrap();
        let other = f.other();
        f.service
            .sample_create(
                &other,
                DemoSampleCreate {
                    code: "A".into(),
                    title: "other".into(),
                    note: "private-other".into(),
                },
            )
            .await
            .unwrap();
        assert_eq!(
            f.service
                .sample_get(&other, DemoSampleId { id: a.id })
                .await
                .unwrap_err()
                .code(),
            SAMPLE_NOT_FOUND
        );
        assert_eq!(
            f.service
                .sample_get(&other, DemoSampleId { id: Id::new() })
                .await
                .unwrap_err()
                .code(),
            SAMPLE_NOT_FOUND
        );
        assert_eq!(f.list(None).await.total, 1);
        let measured = f
            .service
            .measure_start(
                &f.queue,
                &f.actor,
                DemoMeasureInput {
                    samples: vec![version(&a)],
                },
            )
            .await
            .unwrap();
        assert_eq!(f.run(measured.job_id).await.unwrap()["processed"], 1);
        let ready = f.get(a.id).await;
        assert_eq!(ready.character_count, Some(5));
        assert_eq!(ready.stage, DemoSampleStage::Ready);
        assert_eq!(f.service.overview_get(&f.actor).await.unwrap().ready, 1);
        assert_eq!(
            f.service
                .sample_update(
                    &f.actor,
                    DemoSampleUpdate {
                        id: a.id,
                        row_version: 1,
                        title: "stale".into(),
                        note: a.note.clone()
                    }
                )
                .await
                .unwrap_err()
                .code(),
            DATA_VERSION_CONFLICT
        );
        let renamed = f
            .service
            .sample_update(
                &f.actor,
                DemoSampleUpdate {
                    id: a.id,
                    row_version: ready.row_version,
                    title: "title only".into(),
                    note: a.note.clone(),
                },
            )
            .await
            .unwrap();
        assert_eq!(renamed.stage, DemoSampleStage::Ready);
        let edited = f
            .service
            .sample_update(
                &f.actor,
                DemoSampleUpdate {
                    id: a.id,
                    row_version: renamed.row_version,
                    title: "edited".into(),
                    note: "new".into(),
                },
            )
            .await
            .unwrap();
        assert_eq!(edited.stage, DemoSampleStage::Draft);
        assert_eq!(edited.character_count, None);
        assert_eq!(edited.code, "A");
        for code in ["", " A", "A ", "非ASCII", "bad\ncode", &"a".repeat(33)] {
            assert_eq!(
                f.service
                    .sample_create(
                        &f.actor,
                        DemoSampleCreate {
                            code: code.into(),
                            title: "title".into(),
                            note: "".into()
                        }
                    )
                    .await
                    .unwrap_err()
                    .code(),
                INPUT_INVALID
            );
        }
        assert!(
            serde_json::from_value::<DemoSampleCreate>(
                json!({"code":"a","title":"b","note":"","stage":"ready"})
            )
            .is_err()
        );
        assert!(serde_json::from_value::<DemoImportOptions>(json!({"mode":"upsert"})).is_err());
        assert!(
            serde_json::from_value::<DemoListInput>(
                json!({"page":1,"pageSize":10,"unexpected":true})
            )
            .is_err()
        );
        let escaped = f.create("wild", "literal %_!").await;
        assert_eq!(f.list(Some("%_!")).await.items[0].id, escaped.id);
        assert_eq!(f.list(Some("private-other")).await.total, 0);
        assert_eq!(
            f.service
                .sample_delete(&other, version(&edited))
                .await
                .unwrap_err()
                .code(),
            SAMPLE_NOT_FOUND
        );
        f.service
            .sample_delete(&f.actor, version(&edited))
            .await
            .unwrap();
        assert_eq!(
            f.service
                .sample_get(&f.actor, DemoSampleId { id: edited.id })
                .await
                .unwrap_err()
                .code(),
            SAMPLE_NOT_FOUND
        );
        f.registry.stop().await.unwrap();
    })
    .await;
}
