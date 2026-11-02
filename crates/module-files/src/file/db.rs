use std::fs;

use tenon_framework::{
    actor::Actor,
    db::test_support,
    error::{DATA_VERSION_CONFLICT, INPUT_INVALID},
    file::{
        CONTENT_MISMATCH, DEFAULT_MAX_MIB, MISSING, TYPE_NOT_ALLOWED, test_support::file_store,
    },
    ipc::ActorResolver,
};

use super::*;

#[tokio::test]
async fn inputs_paths_creator_ids_previews_and_management() {
    test_support::run(async |test| {
        let (account, registry) = crate::db::setup(test).await;
        let store = file_store(test, DEFAULT_MAX_MIB, &registry.file_purposes()).unwrap();
        let execution =
            ExecutionContext::new(account.resolve_active().await.unwrap().actor, "files-test");
        assert_eq!(purposes(&store).items[0].code, "files.attachment");
        assert!(purposes(&store).items[0].extensions.contains(&"png".into()));

        let source = test.root.path().join("source.txt");
        fs::write(&source, b"content").unwrap();
        let created = add(&store, &execution, "files.attachment", &source)
            .await
            .unwrap();
        assert_eq!(created.created_by, account.owner_id().unwrap());
        assert_eq!(created.original_name, "source.txt");
        assert!(!created.missing);
        let listed = list(
            &store,
            serde_json::from_value(serde_json::json!({
                "page": 1, "pageSize": 20, "purpose": "files.attachment", "keyword": "source"
            }))
            .unwrap(),
        )
        .await
        .unwrap();
        assert_eq!(listed.total, 1);
        assert_eq!(listed.items[0].created_by, account.owner_id().unwrap());
        assert!(matches!(
            preview(&store, FileId { id: created.id }).await.unwrap(),
            FilePreview::Text { text, truncated: false } if text == "content"
        ));

        let unknown = add(
            &store,
            &ExecutionContext::new(Actor::User(Id::new()), "unknown-user"),
            "files.attachment",
            &source,
        )
        .await
        .unwrap();
        let listed = list(
            &store,
            serde_json::from_value(serde_json::json!({"page": 1, "pageSize": 20})).unwrap(),
        )
        .await
        .unwrap();
        assert_eq!(
            listed
                .items
                .iter()
                .find(|r| r.id == unknown.id)
                .unwrap()
                .created_by,
            unknown.created_by
        );
        let summary = serde_json::to_value(&created).unwrap();
        assert!(summary.get("storedPath").is_none());
        assert!(summary.get("path").is_none());

        let destination = test.root.path().join("copy.txt");
        save_copy(&store, created.id, &destination).await.unwrap();
        assert_eq!(fs::read(&destination).unwrap(), b"content");
        let wrong_extension = test.root.path().join("copy.png");
        fs::write(&wrong_extension, b"keep").unwrap();
        assert_eq!(
            save_copy(&store, created.id, &wrong_extension)
                .await
                .unwrap_err()
                .code(),
            TYPE_NOT_ALLOWED
        );
        assert_eq!(fs::read(&wrong_extension).unwrap(), b"keep");
        assert_eq!(
            delete(
                &store,
                FileDelete {
                    id: created.id,
                    row_version: 2
                }
            )
            .await
            .unwrap_err()
            .code(),
            DATA_VERSION_CONFLICT
        );
        save_copy(&store, created.id, &destination).await.unwrap();
        delete(
            &store,
            serde_json::from_value(serde_json::json!({"id": created.id, "rowVersion": 1})).unwrap(),
        )
        .await
        .unwrap();
        assert_eq!(reclaim(&store).await.unwrap().orphan_files, 0);
        assert!(
            serde_json::from_value::<FileDelete>(serde_json::json!({"id": created.id})).is_err()
        );
        assert!(
            serde_json::from_value::<FileId>(serde_json::json!({
                "id": created.id, "path": "extra"
            }))
            .is_err()
        );
        registry.stop().await.unwrap();
    })
    .await;
}

#[tokio::test]
async fn path_validation_text_pages_and_missing_file_reclaim() {
    test_support::run(async |test| {
        let (account, registry) = crate::db::setup(test).await;
        let store = file_store(test, DEFAULT_MAX_MIB, &registry.file_purposes()).unwrap();
        let execution =
            ExecutionContext::new(account.resolve_active().await.unwrap().actor, "files-test");
        let source = test.root.path().join("source.txt");
        let content = "a".repeat(70_000);
        fs::write(&source, &content).unwrap();
        assert_eq!(
            add(&store, &execution, "files.unknown", &source)
                .await
                .unwrap_err()
                .code(),
            INPUT_INVALID
        );
        let unsupported = test.root.path().join("source.exe");
        fs::write(&unsupported, b"content").unwrap();
        assert_eq!(
            add(&store, &execution, "files.attachment", &unsupported)
                .await
                .unwrap_err()
                .code(),
            TYPE_NOT_ALLOWED
        );
        let mismatch = test.root.path().join("source.png");
        fs::write(&mismatch, b"not a png").unwrap();
        assert_eq!(
            add(&store, &execution, "files.attachment", &mismatch)
                .await
                .unwrap_err()
                .code(),
            CONTENT_MISMATCH
        );
        let created = add(&store, &execution, "files.attachment", &source)
            .await
            .unwrap();
        let first = text_page(
            &store,
            FileTextPageInput {
                id: created.id,
                offset: 0,
                fingerprint: None,
            },
        )
        .await
        .unwrap();
        assert_eq!(first.offset, 0);
        assert_eq!(first.total_bytes, content.len() as u64);
        let next = first.next_offset.unwrap();
        assert_eq!(next, first.text.len() as u64);
        let second = text_page(
            &store,
            FileTextPageInput {
                id: created.id,
                offset: next,
                fingerprint: Some(first.fingerprint.clone()),
            },
        )
        .await
        .unwrap();
        assert_eq!(second.fingerprint, first.fingerprint);
        assert_eq!(second.next_offset, None);
        assert_eq!(first.text + &second.text, content);
        assert_eq!(
            text_page(
                &store,
                FileTextPageInput {
                    id: created.id,
                    offset: next,
                    fingerprint: None,
                }
            )
            .await
            .unwrap_err()
            .code(),
            INPUT_INVALID
        );

        let record = store.get(created.id).await.unwrap();
        fs::remove_file(test.root.path().join("files").join(record.stored_path)).unwrap();
        assert_eq!(reclaim(&store).await.unwrap().missing_rows, 1);
        let listed = list(
            &store,
            serde_json::from_value(serde_json::json!({
                "page": 1, "pageSize": 20
            }))
            .unwrap(),
        )
        .await
        .unwrap();
        assert_eq!(listed.total, 1);
        assert!(listed.items[0].missing);
        assert_eq!(
            preview(&store, FileId { id: created.id })
                .await
                .unwrap_err()
                .code(),
            MISSING
        );
        registry.stop().await.unwrap();
    })
    .await;
}
