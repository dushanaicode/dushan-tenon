#![cfg(windows)]

use std::panic::{AssertUnwindSafe, catch_unwind, resume_unwind};

use secrecy::{ExposeSecret, SecretString};
use tenon_framework::secret::SecretStore;

#[test]
#[ignore = "真实 Windows 凭据库；维护者取得同意并设置 TENON_TEST_KEYRING=1 后显式运行"]
fn windows_keyring_roundtrip_and_delete() {
    assert_eq!(
        std::env::var("TENON_TEST_KEYRING").as_deref(),
        Ok("1"),
        "必须显式授权真实凭据库测试"
    );
    let root = tempfile::Builder::new()
        .prefix("keyring-")
        .tempdir_in(std::env::temp_dir())
        .unwrap();
    let store = SecretStore::new(root.path(), "tenon-test-keyring").unwrap();
    let key = format!("integration.test_{}", uuid::Uuid::now_v7().simple());
    let value = SecretString::from(uuid::Uuid::now_v7().to_string());
    store.set(&key, &value).unwrap();
    let outcome = catch_unwind(AssertUnwindSafe(|| {
        assert!(store.get(&key).unwrap().expose_secret() == value.expose_secret());
    }));
    store.delete(&key).unwrap();
    assert_eq!(
        store.get(&key).unwrap_err().to_string(),
        "app.secret.not_found"
    );
    if let Err(error) = outcome {
        resume_unwind(error);
    }
}
