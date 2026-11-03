use super::{tests::store, *};
use serde_json::json;

#[test]
fn objects_persist_without_business_content_and_stay_independent_from_geometry() {
    // 工作台只保存引用；业务 API 负责授权与对象存在性。
    let (root, store) = store();
    let subject = Id::new();
    let object = WorkbenchObject {
        kind: WorkbenchObjectKind::Job,
        id: Id::new(),
    };
    let objects = store
        .update(
            subject,
            WorkbenchUpdate {
                expected_revision: 0,
                change: WorkbenchChange::SetObjects {
                    objects: vec![object.clone()],
                    active_object: Some(object.clone()),
                },
            },
        )
        .unwrap();
    assert_eq!(objects.layouts, WorkbenchLayouts::default());
    assert_eq!(objects.auxiliary, AuxiliaryLayout::default());
    let auxiliary = AuxiliaryLayout {
        width: AUXILIARY_MAX,
        visible: true,
        panel: Some("job-inspector".into()),
    };
    let panel = store
        .update(
            subject,
            WorkbenchUpdate {
                expected_revision: 1,
                change: WorkbenchChange::SetAuxiliary {
                    auxiliary: auxiliary.clone(),
                },
            },
        )
        .unwrap();
    assert_eq!(panel.objects, objects.objects);
    assert_eq!(panel.active_object, objects.active_object);
    assert_eq!(panel.layouts, objects.layouts);
    let console = WorkbenchLayout {
        primary_width: PRIMARY_MAX,
        primary_collapsed: true,
    };
    let saved = store
        .update(
            subject,
            WorkbenchUpdate {
                expected_revision: 2,
                change: WorkbenchChange::SetLayout {
                    layout: WorkbenchLayoutChange::Console(console.clone()),
                },
            },
        )
        .unwrap();
    assert_eq!(saved.revision, 3);
    assert_eq!(saved.objects, vec![object.clone()]);
    assert_eq!(saved.active_object, Some(object));
    assert_eq!(saved.auxiliary, auxiliary);
    assert_eq!(saved.layouts.console, console);
    let restarted = WorkbenchStore::new(root.path(), &root.path().join("Temp"));
    assert_eq!(restarted.get(subject).unwrap(), saved);
    assert_eq!(
        restarted.get(Id::new()).unwrap(),
        WorkbenchSnapshot::default()
    );
    assert!(
        restarted
            .read(subject, "another")
            .unwrap()
            .objects
            .is_empty()
    );
    let persisted: serde_json::Value =
        serde_json::from_slice(&fs::read(store.path(subject, DEFAULT_WORKSPACE)).unwrap()).unwrap();
    assert_eq!(persisted["objects"][0].as_object().unwrap().len(), 2);
    assert!(persisted["objects"][0].get("title").is_none());
    assert!(persisted["layouts"]["console"].get("objects").is_none());
    assert!(persisted["layouts"]["console"].get("auxiliary").is_none());
    let reset = restarted
        .reset_layout(
            subject,
            WorkbenchResetLayout {
                expected_revision: 3,
            },
        )
        .unwrap();
    assert_eq!(
        reset,
        WorkbenchSnapshot {
            revision: 4,
            ..Default::default()
        }
    );
    assert_eq!(restarted.get(subject).unwrap(), reset);
}

#[test]
fn rejects_invalid_object_references_without_overwriting() {
    let (_root, store) = store();
    let subject = Id::new();
    let saved = store
        .reset_layout(
            subject,
            WorkbenchResetLayout {
                expected_revision: 0,
            },
        )
        .unwrap();
    let path = store.path(subject, DEFAULT_WORKSPACE);
    let original = fs::read(&path).unwrap();
    let object = WorkbenchObject {
        kind: WorkbenchObjectKind::Job,
        id: Id::new(),
    };
    for (objects, active_object) in [
        (vec![object.clone(), object.clone()], None),
        (Vec::new(), Some(object.clone())),
        (
            (0..=MAX_OBJECTS)
                .map(|_| WorkbenchObject {
                    kind: WorkbenchObjectKind::Job,
                    id: Id::new(),
                })
                .collect(),
            None,
        ),
    ] {
        assert_eq!(
            store
                .update(
                    subject,
                    WorkbenchUpdate {
                        expected_revision: 1,
                        change: WorkbenchChange::SetObjects {
                            objects: objects.clone(),
                            active_object: active_object.clone()
                        },
                    }
                )
                .unwrap_err()
                .code(),
            INVALID
        );
        assert_eq!(fs::read(&path).unwrap(), original);
        let invalid = WorkbenchSnapshot {
            objects,
            active_object,
            ..saved.clone()
        };
        let bytes = serde_json::to_vec(&invalid).unwrap();
        fs::write(&path, &bytes).unwrap();
        assert_eq!(store.get(subject).unwrap_err().code(), INVALID);
        assert_eq!(
            store
                .reset_layout(
                    subject,
                    WorkbenchResetLayout {
                        expected_revision: 1
                    }
                )
                .unwrap_err()
                .code(),
            INVALID
        );
        assert_eq!(fs::read(&path).unwrap(), bytes);
        fs::write(&path, &original).unwrap();
    }
    for invalid in [
        json!({"kind":"file","id":object.id}),
        json!({"kind":"job","id":"job-1"}),
        json!({"kind":"job","id":"01999000-1234-4000-8000-123456789abc"}),
        json!({"kind":"job","id":"01999000-1234-7000-8000-123456789ABC"}),
        json!({"kind":"job","id":object.id,"title":"secret"}),
    ] {
        let input = json!({"expectedRevision":1,"change":{"kind":"set-objects","objects":[invalid],"activeObject":null}});
        assert!(serde_json::from_value::<WorkbenchUpdate>(input).is_err());
    }
    for field in ["objects", "activeObject"] {
        let mut old = serde_json::to_value(&saved).unwrap();
        old.as_object_mut().unwrap().remove(field);
        let bytes = serde_json::to_vec(&old).unwrap();
        fs::write(&path, &bytes).unwrap();
        assert_eq!(store.get(subject).unwrap_err().code(), INVALID);
        assert_eq!(
            store
                .reset_layout(
                    subject,
                    WorkbenchResetLayout {
                        expected_revision: 1
                    }
                )
                .unwrap_err()
                .code(),
            INVALID
        );
        assert_eq!(fs::read(&path).unwrap(), bytes);
        let mut change = json!({"kind":"set-objects","objects":[],"activeObject":null});
        change.as_object_mut().unwrap().remove(field);
        assert!(serde_json::from_value::<WorkbenchChange>(change).is_err());
    }
    fs::write(&path, &original).unwrap();
    let objects: Vec<_> = (0..MAX_OBJECTS)
        .map(|_| WorkbenchObject {
            kind: WorkbenchObjectKind::Job,
            id: Id::new(),
        })
        .collect();
    let active_object = objects.last().cloned();
    let saved = store
        .update(
            subject,
            WorkbenchUpdate {
                expected_revision: 1,
                change: WorkbenchChange::SetObjects {
                    objects: objects.clone(),
                    active_object: active_object.clone(),
                },
            },
        )
        .unwrap();
    assert_eq!(saved.objects, objects);
    assert_eq!(saved.active_object, active_object);
    assert_eq!(store.get(subject).unwrap(), saved);
}
