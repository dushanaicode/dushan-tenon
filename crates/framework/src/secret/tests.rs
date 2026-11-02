use std::{
    cell::{Cell, RefCell},
    collections::BTreeMap,
    rc::Rc,
};

use secrecy::ExposeSecret;

use super::*;

#[derive(Clone, Default)]
struct Memory {
    values: Rc<RefCell<BTreeMap<String, SecretString>>>,
    reads: Rc<Cell<usize>>,
}

impl CredentialBackend for Memory {
    fn get(&self, account: &str) -> Result<SecretString, CredentialError> {
        self.reads.set(self.reads.get() + 1);
        self.values
            .borrow()
            .get(account)
            .cloned()
            .ok_or(CredentialError::NotFound)
    }
    fn set(&self, account: &str, value: &SecretString) -> Result<(), CredentialError> {
        self.values
            .borrow_mut()
            .insert(account.to_owned(), value.clone());
        Ok(())
    }
    fn delete(&self, account: &str) -> Result<(), CredentialError> {
        self.values
            .borrow_mut()
            .remove(account)
            .map(|_| ())
            .ok_or(CredentialError::NotFound)
    }
}

fn root() -> tempfile::TempDir {
    tempfile::Builder::new()
        .prefix("secret-")
        .tempdir_in(std::env::temp_dir())
        .unwrap()
}

#[test]
fn environment_is_authoritative_including_empty_value_and_error() {
    let root = root();
    let memory = Memory::default();
    let store = SecretStore::with_backend(root.path(), memory.clone()).unwrap();
    store
        .set("database.password", &SecretString::from("stored-fixture"))
        .unwrap();
    for value in ["environment-fixture", ""] {
        let secret = store
            .get_from("database.password", |name| {
                assert_eq!(name, "TENON_SECRET__DATABASE__PASSWORD");
                Ok(Some(SecretString::from(value)))
            })
            .unwrap();
        assert_eq!(secret.expose_secret(), value);
    }
    assert_eq!(
        store
            .get_from("database.password", |_| Err(CredentialError::Unavailable))
            .unwrap_err()
            .code,
        SECRET_UNAVAILABLE
    );
    assert_eq!(memory.reads.get(), 0);
    assert_eq!(
        store
            .get_stored("database.password")
            .unwrap()
            .expose_secret(),
        "stored-fixture"
    );
    assert_eq!(
        store
            .get_from("database.password", |_| Ok(None))
            .unwrap()
            .expose_secret(),
        "stored-fixture"
    );
    store.delete("database.password").unwrap();
    let missing = store
        .get_from("database.password", |_| Ok(None))
        .unwrap_err();
    assert_eq!(missing.code, SECRET_NOT_FOUND);
    assert_eq!(missing.params["key"], "database.password");
    assert_eq!(
        store.delete("database.password").unwrap_err().code,
        SECRET_NOT_FOUND
    );
}

#[test]
fn namespace_uses_canonical_path_digest_and_isolates_state_roots() {
    let first = root();
    let second = root();
    std::fs::create_dir(first.path().join("child")).unwrap();
    let memory = Memory::default();
    let store = SecretStore::with_backend(first.path(), memory.clone()).unwrap();
    let same =
        SecretStore::with_backend(&first.path().join("child").join(".."), memory.clone()).unwrap();
    let other = SecretStore::with_backend(second.path(), memory.clone()).unwrap();
    store
        .set("database.password", &SecretString::from("isolated-fixture"))
        .unwrap();
    assert_eq!(
        same.get_from("database.password", |_| Ok(None))
            .unwrap()
            .expose_secret(),
        "isolated-fixture"
    );
    assert_eq!(
        other
            .get_from("database.password", |_| Ok(None))
            .unwrap_err()
            .code,
        SECRET_NOT_FOUND
    );
    let normalized = first.path().canonicalize().unwrap();
    let text = normalized.to_str().unwrap();
    #[cfg(windows)]
    let text = text.to_lowercase();
    let digest = format!("{:x}", Sha256::digest(text.as_bytes()));
    assert_eq!(
        store.account("database.password"),
        format!("{}/database.password", &digest[..16])
    );
    assert!(SecretStore::with_backend(&first.path().join("missing"), memory).is_err());
}

#[test]
fn key_validation_happens_before_any_source_access() {
    let root = root();
    let store = SecretStore::with_backend(root.path(), Memory::default()).unwrap();
    for key in [
        "",
        "database",
        "Database.password",
        "database..password",
        ".password",
        "database.password.",
        "database.pass-word",
        "database.密码",
    ] {
        assert_eq!(
            store
                .get_from(key, |_| panic!("must validate first"))
                .unwrap_err()
                .code,
            SECRET_INVALID_KEY
        );
        assert_eq!(
            store
                .set(key, &SecretString::from("fixture"))
                .unwrap_err()
                .code,
            SECRET_INVALID_KEY
        );
        assert_eq!(store.delete(key).unwrap_err().code, SECRET_INVALID_KEY);
    }
    assert!(is_valid_key("app.database.password_2"));
}

#[test]
fn debug_and_errors_do_not_expose_secrets() {
    let root = root();
    let store = SecretStore::with_backend(root.path(), Memory::default()).unwrap();
    let value = SecretString::from("never-print-this-fixture");
    store.set("database.password", &value).unwrap();
    for text in [
        format!("{value:?}"),
        format!("{store:?}"),
        format!(
            "{:?}",
            secret_error("database.password", "get", CredentialError::Unavailable)
        ),
    ] {
        assert!(!text.contains(value.expose_secret()));
    }
}

#[cfg(any(windows, target_os = "macos", target_os = "linux"))]
#[test]
fn keyring_bad_encoding_bytes_are_discarded() {
    let error = credential_error(keyring::Error::BadEncoding(b"never-log-fixture".to_vec()));
    assert!(!format!("{error:?}").contains("never-log-fixture"));
}

#[test]
fn environment_names_are_derived_from_validated_keys() {
    assert_eq!(
        environment_variable("network.proxy_credentials").unwrap(),
        "TENON_SECRET__NETWORK__PROXY_CREDENTIALS"
    );
    assert_eq!(
        environment_variable("invalid").unwrap_err().code(),
        SECRET_INVALID_KEY
    );
}

#[test]
fn memory_backend_poisoning_returns_unavailable_without_secret_text() {
    let memory = MemoryCredentials::default();
    let poisoned = memory.clone();
    assert!(
        std::thread::spawn(move || {
            let _guard = poisoned.0.lock().unwrap();
            panic!("synthetic poisoning");
        })
        .join()
        .is_err()
    );
    assert!(matches!(
        memory.get("account"),
        Err(CredentialError::Unavailable)
    ));
    assert!(matches!(
        memory.set("account", &SecretString::from("fixture")),
        Err(CredentialError::Unavailable)
    ));
    assert!(matches!(
        memory.delete("account"),
        Err(CredentialError::Unavailable)
    ));
}
