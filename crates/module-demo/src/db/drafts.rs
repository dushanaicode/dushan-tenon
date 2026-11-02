use super::*;

#[tokio::test]
async fn draft_recovery_and_final_commit_never_revive_old_writers() {
    test_support::run(async |test| {
        let f = Fixture::new(test).await;
        let opened = f
            .service
            .draft_open(&f.actor, DemoDraftOpen { sample_id: None })
            .await
            .unwrap();
        assert!(!opened.recovered);
        let fields = DemoDraftFields {
            code: "DRAFT-1".into(),
            title: String::new(),
            note: "未完成🙂".into(),
        };
        let receipt = f
            .service
            .draft_write(
                &f.actor,
                DemoDraftWrite {
                    lease: opened.lease.clone(),
                    fields: fields.clone(),
                },
            )
            .await
            .unwrap();
        let lease = DemoDraftLease {
            revision: receipt.revision,
            ..opened.lease.clone()
        };
        assert_eq!(
            f.service
                .draft_commit(&f.actor, lease.clone())
                .await
                .unwrap_err()
                .code(),
            INPUT_INVALID
        );
        let restored = f
            .service
            .draft_open(&f.actor, DemoDraftOpen { sample_id: None })
            .await
            .unwrap();
        assert!(restored.recovered);
        assert_eq!(restored.fields, fields);
        assert_ne!(restored.lease.session_id, lease.session_id);
        assert_eq!(
            f.service
                .draft_write(
                    &f.actor,
                    DemoDraftWrite {
                        lease,
                        fields: fields.clone()
                    }
                )
                .await
                .unwrap_err()
                .code(),
            DRAFT_EXPIRED
        );
        let complete = DemoDraftFields {
            title: "Saved from draft".into(),
            ..fields
        };
        let receipt = f
            .service
            .draft_write(
                &f.actor,
                DemoDraftWrite {
                    lease: restored.lease.clone(),
                    fields: complete.clone(),
                },
            )
            .await
            .unwrap();
        let lease = DemoDraftLease {
            revision: receipt.revision,
            ..restored.lease
        };
        let saved = f
            .service
            .draft_commit(&f.actor, lease.clone())
            .await
            .unwrap();
        assert_eq!(saved.code, "DRAFT-1");
        assert_eq!(saved.note, complete.note);
        assert!(
            test.rows::<(Id,)>("demo_sample_draft", &["id"])
                .await
                .is_empty()
        );
        assert_eq!(
            f.service
                .draft_write(
                    &f.actor,
                    DemoDraftWrite {
                        lease,
                        fields: complete
                    }
                )
                .await
                .unwrap_err()
                .code(),
            DRAFT_EXPIRED
        );
        let next = f
            .service
            .draft_open(&f.actor, DemoDraftOpen { sample_id: None })
            .await
            .unwrap();
        assert!(!next.recovered);
        assert_eq!(next.fields.code, "");
        f.registry.stop().await.unwrap();
    })
    .await;
}

#[tokio::test]
async fn draft_base_version_conflict_is_preserved_and_discard_is_scoped() {
    test_support::run(async |test| {
        let f = Fixture::new(test).await;
        let sample = f.create("draft-conflict", "original").await;
        let opened = f
            .service
            .draft_open(
                &f.actor,
                DemoDraftOpen {
                    sample_id: Some(sample.id),
                },
            )
            .await
            .unwrap();
        let fields = DemoDraftFields {
            note: "my unfinished note".into(),
            ..opened.fields.clone()
        };
        let receipt = f
            .service
            .draft_write(
                &f.actor,
                DemoDraftWrite {
                    lease: opened.lease.clone(),
                    fields: fields.clone(),
                },
            )
            .await
            .unwrap();
        let lease = DemoDraftLease {
            revision: receipt.revision,
            ..opened.lease
        };
        let updated = f
            .service
            .sample_update(
                &f.actor,
                DemoSampleUpdate {
                    id: sample.id,
                    row_version: sample.row_version,
                    title: sample.title,
                    note: "another write".into(),
                },
            )
            .await
            .unwrap();
        assert_eq!(
            f.service
                .draft_commit(&f.actor, lease.clone())
                .await
                .unwrap_err()
                .code(),
            DATA_VERSION_CONFLICT
        );
        assert_eq!(f.get(sample.id).await.note, "another write");
        let restored = f
            .service
            .draft_open(
                &f.actor,
                DemoDraftOpen {
                    sample_id: Some(sample.id),
                },
            )
            .await
            .unwrap();
        assert!(restored.conflict);
        assert!(restored.recovered);
        assert_eq!(restored.fields.note, "my unfinished note");
        assert_eq!(restored.baseline.note, updated.note);
        assert_eq!(
            f.service
                .draft_discard(&f.other(), restored.lease.clone())
                .await
                .unwrap_err()
                .code(),
            DRAFT_EXPIRED
        );
        f.service
            .draft_discard(&f.actor, restored.lease.clone())
            .await
            .unwrap();
        assert_eq!(
            f.service
                .draft_write(
                    &f.actor,
                    DemoDraftWrite {
                        lease: restored.lease,
                        fields
                    }
                )
                .await
                .unwrap_err()
                .code(),
            DRAFT_EXPIRED
        );
        f.registry.stop().await.unwrap();
    })
    .await;
}

#[tokio::test]
async fn draft_commit_rolls_back_and_existing_edits_share_sample_semantics() {
    test_support::run(async |test| {
        let f = Fixture::new(test).await;
        let sample = f.create("taken", "old").await;
        let mut draft = f
            .service
            .draft_open(&f.actor, DemoDraftOpen { sample_id: None })
            .await
            .unwrap();
        let fields = DemoDraftFields {
            code: "taken".into(),
            title: "collision".into(),
            note: "preserve me".into(),
        };
        draft.lease.revision = f
            .service
            .draft_write(
                &f.actor,
                DemoDraftWrite {
                    lease: draft.lease.clone(),
                    fields,
                },
            )
            .await
            .unwrap()
            .revision;
        assert_eq!(
            f.service
                .draft_commit(&f.actor, draft.lease.clone())
                .await
                .unwrap_err()
                .code(),
            CODE_CONFLICT
        );
        assert_eq!(
            test.rows::<(Id,)>("demo_sample_draft", &["id"]).await.len(),
            1
        );
        f.service
            .draft_discard(&f.actor, draft.lease)
            .await
            .unwrap();
        let mut draft = f
            .service
            .draft_open(
                &f.actor,
                DemoDraftOpen {
                    sample_id: Some(sample.id),
                },
            )
            .await
            .unwrap();
        let fields = DemoDraftFields {
            note: "new".into(),
            ..draft.fields.clone()
        };
        draft.lease.revision = f
            .service
            .draft_write(
                &f.actor,
                DemoDraftWrite {
                    lease: draft.lease.clone(),
                    fields,
                },
            )
            .await
            .unwrap()
            .revision;
        let edited = f.service.draft_commit(&f.actor, draft.lease).await.unwrap();
        assert_eq!(edited.id, sample.id);
        assert_eq!(edited.row_version, sample.row_version + 1);
        assert_eq!(edited.note, "new");
        assert!(
            test.rows::<(Id,)>("demo_sample_draft", &["id"])
                .await
                .is_empty()
        );
        f.registry.stop().await.unwrap();
    })
    .await;
}

#[tokio::test]
async fn drafts_enforce_budget_expiry_and_live_developer_gate() {
    test_support::run(async |test| {
        let f = Fixture::new(test).await;
        let draft = f
            .service
            .draft_open(&f.actor, DemoDraftOpen { sample_id: None })
            .await
            .unwrap();
        let invalid = DemoDraftFields {
            code: "X".into(),
            title: "a".repeat(121),
            note: String::new(),
        };
        assert_eq!(
            f.service
                .draft_write(
                    &f.actor,
                    DemoDraftWrite {
                        lease: draft.lease.clone(),
                        fields: invalid
                    }
                )
                .await
                .unwrap_err()
                .code(),
            INPUT_INVALID
        );
        f.service
            .draft_write(
                &f.actor,
                DemoDraftWrite {
                    lease: draft.lease.clone(),
                    fields: DemoDraftFields {
                        code: "pending".into(),
                        title: String::new(),
                        note: String::new(),
                    },
                },
            )
            .await
            .unwrap();
        for index in 0..31 {
            let row = f.create(&format!("limit-{index}"), "").await;
            let opened = f
                .service
                .draft_open(
                    &f.actor,
                    DemoDraftOpen {
                        sample_id: Some(row.id),
                    },
                )
                .await
                .unwrap();
            f.service
                .draft_write(
                    &f.actor,
                    DemoDraftWrite {
                        lease: opened.lease,
                        fields: DemoDraftFields {
                            code: row.code,
                            title: row.title,
                            note: "pending".into(),
                        },
                    },
                )
                .await
                .unwrap();
        }
        let last = f.create("limit-last", "").await;
        assert_eq!(
            f.service
                .draft_open(
                    &f.actor,
                    DemoDraftOpen {
                        sample_id: Some(last.id)
                    }
                )
                .await
                .unwrap_err()
                .code(),
            DRAFT_LIMIT
        );
        test.raw("UPDATE demo_sample_draft SET updated_at = 0")
            .await;
        assert_eq!(
            f.service
                .draft_discard(&f.actor, draft.lease)
                .await
                .unwrap_err()
                .code(),
            DRAFT_EXPIRED
        );
        let fresh = f
            .service
            .draft_open(
                &f.actor,
                DemoDraftOpen {
                    sample_id: Some(last.id),
                },
            )
            .await
            .unwrap();
        assert!(!fresh.recovered);
        assert_eq!(
            test.rows::<(Id,)>("demo_sample_draft", &["id"]).await.len(),
            1
        );
        f.preferences.lock().unwrap().developer_mode = false;
        assert_eq!(
            f.service
                .draft_open(&f.actor, DemoDraftOpen { sample_id: None })
                .await
                .unwrap_err()
                .code(),
            MODE_DISABLED
        );
        assert_eq!(
            f.service
                .draft_discard(&f.actor, fresh.lease)
                .await
                .unwrap_err()
                .code(),
            MODE_DISABLED
        );
        f.registry.stop().await.unwrap();
    })
    .await;
}
