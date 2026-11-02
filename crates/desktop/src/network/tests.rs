//! 秘密写回事务的故障矩阵和真实配置/内存秘密库集成。
use super::*;
use std::cell::RefCell;
use tenon_framework::{
    error::PERMISSION_DENIED,
    secret::{MemoryCredentials, SECRET_UNAVAILABLE},
};

fn replacement() -> NetworkSettingsUpdate {
    NetworkSettingsUpdate {
        mode: ProxyMode::Manual,
        endpoint: "http://127.0.0.1:3128".into(),
        auth: true,
        credentials: ProxyCredentialChange::Replace(ProxyCredentialReplacement {
            username: "synthetic-user".into(),
            password: "synthetic-password".into(),
        }),
    }
}

#[test]
fn proxy_secret_rollback_and_no_leaks() {
    let root = tempfile::tempdir().unwrap();
    let secrets = SecretStore::with_backend(root.path(), MemoryCredentials::default()).unwrap();
    let mut config = crate::config::load(root.path(), [], &[]).unwrap();
    // 原秘密即使格式损坏，也必须按原字节补偿，不能用新的已解析结构覆盖。
    secrets
        .set(CREDENTIALS_KEY, &"original-malformed".into())
        .unwrap();
    assert_eq!(
        update(
            &mut config,
            &root.path().join("missing"),
            &secrets,
            replacement(),
            || Ok(())
        )
        .unwrap_err()
        .code(),
        INTERNAL_UNEXPECTED
    );
    assert!(ProxyCredentials::parse(&secrets.get_stored(CREDENTIALS_KEY).unwrap()).is_err());
    assert_eq!(config.proxy().mode(), ProxyMode::Direct);
    let saved = update(&mut config, root.path(), &secrets, replacement(), || Ok(())).unwrap();
    for text in [
        serde_json::to_string(&saved).unwrap(),
        format!("{saved:?}"),
        std::fs::read_to_string(root.path().join("config.toml")).unwrap(),
    ] {
        assert!(!text.contains("synthetic-user"));
        assert!(!text.contains("synthetic-password"));
    }
    disable(&mut config, root.path(), &secrets, || Ok(())).unwrap();
    assert_eq!(config.proxy().mode(), ProxyMode::Direct);
    assert_eq!(config.proxy().endpoint(), "http://127.0.0.1:3128");
    assert!(config.proxy().auth());
    assert!(
        settings(&config, &secrets, || Ok(()))
            .unwrap()
            .credentials_set
    );
    let mut clear = replacement();
    clear.auth = false;
    clear.credentials = ProxyCredentialChange::Clear(NoProxyCredentials {});
    update(&mut config, root.path(), &secrets, clear, || Ok(())).unwrap();
    assert!(!config.proxy().auth());
    assert_eq!(
        secrets.get_stored(CREDENTIALS_KEY).err().unwrap().code(),
        SECRET_NOT_FOUND
    );
    let mut keep = replacement();
    keep.credentials = ProxyCredentialChange::Keep(NoProxyCredentials {});
    assert_eq!(
        update(&mut config, root.path(), &secrets, keep, || Ok(()))
            .unwrap_err()
            .code(),
        CREDENTIALS_MISSING
    );
}

#[test]
fn permission_source_and_structure_fail_before_secret_write() {
    let root = tempfile::tempdir().unwrap();
    let secrets = SecretStore::with_backend(root.path(), MemoryCredentials::default()).unwrap();
    let mut config = crate::config::load(root.path(), [], &[]).unwrap();
    assert_eq!(
        update(&mut config, root.path(), &secrets, replacement(), || Err(
            AppError::new(PERMISSION_DENIED)
        ))
        .unwrap_err()
        .code(),
        PERMISSION_DENIED
    );
    assert_eq!(
        update_with_source(&mut config, root.path(), &secrets, replacement(), true)
            .unwrap_err()
            .code(),
        SETTINGS_OVERRIDDEN
    );
    for key in [
        "network.proxy_mode=direct",
        "network.proxy_endpoint=",
        "network.proxy_auth=false",
    ] {
        let mut overridden = crate::config::load(root.path(), [], &[key.into()]).unwrap();
        assert_eq!(
            update(
                &mut overridden,
                root.path(),
                &secrets,
                replacement(),
                || Ok(())
            )
            .unwrap_err()
            .code(),
            SETTINGS_OVERRIDDEN
        );
    }
    let mut invalid = replacement();
    invalid.endpoint = "http://remote.example".into();
    assert_eq!(
        update(&mut config, root.path(), &secrets, invalid, || Ok(()))
            .unwrap_err()
            .code(),
        INVALID_PROXY
    );
    let mut invalid = replacement();
    invalid.credentials = ProxyCredentialChange::Clear(NoProxyCredentials {});
    assert_eq!(
        update(&mut config, root.path(), &secrets, invalid, || Ok(()))
            .unwrap_err()
            .code(),
        INVALID_PROXY
    );
    assert_eq!(
        secrets.get_stored(CREDENTIALS_KEY).err().unwrap().code(),
        SECRET_NOT_FOUND
    );
    assert!(!root.path().join("config.toml").exists());
    assert!(serde_json::from_str::<NetworkSettingsUpdate>(r#"{"mode":"direct","endpoint":"","auth":false,"credentials":{"type":"keep","password":"sentinel"}}"#).is_err());
}

#[test]
fn partial_secret_writes_and_config_failures_restore_exact_original() {
    for original in [None, Some("exact original bytes")] {
        for next in [None, Some("replacement bytes")] {
            for secret_fails in [false, true] {
                for compensation_fails in [false, true] {
                    let value = RefCell::new(original);
                    let mut calls = 0;
                    let error = commit_secrets(
                        true,
                        original.as_ref(),
                        next.as_ref(),
                        |incoming| {
                            calls += 1;
                            *value.borrow_mut() = incoming.copied();
                            if (calls == 1 && secret_fails) || (calls == 2 && compensation_fails) {
                                Err(AppError::new(SECRET_UNAVAILABLE))
                            } else {
                                Ok(())
                            }
                        },
                        || Err(AppError::new(INTERNAL_UNEXPECTED)),
                    )
                    .unwrap_err();
                    assert_eq!(calls, 2);
                    assert_eq!(*value.borrow(), original);
                    assert_eq!(
                        error.code(),
                        if compensation_fails {
                            COMPENSATION_FAILED
                        } else if secret_fails {
                            SECRET_UNAVAILABLE
                        } else {
                            INTERNAL_UNEXPECTED
                        }
                    );
                }
            }
        }
    }
}

#[test]
fn keeping_secret_never_writes_even_when_config_fails() {
    assert_eq!(
        commit_secrets(
            false,
            Some(&"original"),
            Some(&"original"),
            |_| panic!("keep cannot write"),
            || Err(AppError::new(INTERNAL_UNEXPECTED))
        )
        .unwrap_err()
        .code(),
        INTERNAL_UNEXPECTED
    );
}
