use super::*;

#[test]
fn internal_error_serialization_hides_source_and_params() {
    let _guard = IPC_TEST_LOCK.lock().unwrap();
    let error = ready(execute(&test_context(0), "app_about_get", |_| async {
        Err::<(), _>(
            AppError::new(INTERNAL_UNEXPECTED)
                .with_param("secret", "private-param")
                .with_source(io::Error::other("private-source")),
        )
    }))
    .unwrap_err();
    let value = serde_json::to_value(error).unwrap();
    assert_eq!(value["code"], "app.internal.unexpected");
    assert_eq!(value["params"], serde_json::json!({}));
    assert_eq!(value.as_object().unwrap().len(), 3);
    assert!(value["traceId"].is_string());
    assert!(!value.to_string().contains("private"));
}

#[test]
fn expected_error_preserves_code_and_field_path() {
    let _guard = IPC_TEST_LOCK.lock().unwrap();
    let error = ready(execute(&test_context(0), "app_about_get", |_| async {
        Err::<(), _>(AppError::new(INPUT_INVALID).with_param("path", "logging.level"))
    }))
    .unwrap_err();
    assert_eq!(error.code, INPUT_INVALID.as_str());
    assert_eq!(
        error.params,
        BTreeMap::from([("path".into(), "logging.level".into())])
    );
}

#[test]
fn trace_id_is_a_canonical_uuid_v7() {
    let _guard = IPC_TEST_LOCK.lock().unwrap();
    let error = ready(execute(&test_context(0), "app_about_get", |_| async {
        Err::<(), _>(AppError::new(INPUT_INVALID))
    }))
    .unwrap_err();
    let id = Uuid::parse_str(&error.trace_id).unwrap();
    assert_eq!(id.get_version_num(), 7);
    assert_eq!(id.to_string(), error.trace_id);
}
