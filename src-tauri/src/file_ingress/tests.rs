use super::*;
use tenon_framework::id::Id;

#[test]
fn uri_accepts_only_the_product_route_without_credentials_or_payload() {
    let ingress = FileIngress::default();
    let root = crate::boot::tests::root();
    let owner = Id::new();
    enqueue_uri(
        &ingress,
        "com.dushan.tenon://open/sample/items",
        "com.dushan.tenon",
        None,
    )
    .unwrap();
    let snapshot = ingress.list(root.path(), owner).unwrap();
    assert!(
        matches!(&snapshot.pending[0], FileIngressItem::Route { path, .. } if path == "/sample/items")
    );
    for raw in [
        "other://open/sample",
        "com.dushan.tenon://other/sample",
        "com.dushan.tenon://user:secret@open/sample",
        "com.dushan.tenon://open:80/sample",
        "com.dushan.tenon://open/sample?file=private",
        "com.dushan.tenon://open/sample#private",
        "com.dushan.tenon://open/%2e%2e/secret",
        "com.dushan.tenon://open/sample/../secret",
        "com.dushan.tenon://open//sample",
        "com.dushan.tenon://open/sample\\secret",
    ] {
        assert_eq!(
            enqueue_uri(&ingress, raw, "com.dushan.tenon", None)
                .unwrap_err()
                .code(),
            INVALID,
            "{raw}"
        );
    }
    assert_eq!(ingress.list(root.path(), owner).unwrap().pending.len(), 1);
}

#[test]
fn cli_paths_file_uris_and_routes_share_the_bounded_queue_and_stop_on_closing() {
    let root = crate::boot::tests::root();
    let path = root.path().join("sample.csv");
    std::fs::write(&path, "a,b\n").unwrap();
    let app = crate::boot::tests::app();
    let lifecycle = Lifecycle::new();
    enqueue_arguments(
        app.handle(),
        &lifecycle,
        &[
            "sample.csv".into(),
            tauri::Url::from_file_path(&path).unwrap().into(),
        ],
        root.path(),
        None,
    );
    let owner = Id::new();
    assert_eq!(
        lifecycle
            .file_ingress
            .list(root.path(), owner)
            .unwrap()
            .pending
            .len(),
        1
    );
    let other = crate::boot::tests::root();
    enqueue_arguments(
        app.handle(),
        &lifecycle,
        &["sample.csv".into()],
        root.path(),
        Some(other.path().canonicalize().unwrap()),
    );
    assert_eq!(
        lifecycle
            .file_ingress
            .list(root.path(), owner)
            .unwrap()
            .pending
            .len(),
        1
    );
    lifecycle.exit.begin();
    enqueue_arguments(
        app.handle(),
        &lifecycle,
        &["sample.csv".into()],
        root.path(),
        None,
    );
    assert_eq!(
        lifecycle
            .file_ingress
            .list(root.path(), owner)
            .unwrap()
            .pending
            .len(),
        1
    );
}
