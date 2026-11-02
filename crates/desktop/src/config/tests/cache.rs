//! cache 行为测试。

use super::*;

#[test]
fn redis_ca_path_and_secret_validation_match_database_rules() {
    let root = state_root();
    fs::write(
        root.path().join("config.toml"),
        "[cache]\nprovider='redis'\nhost='localhost'\nport=6379\nusername='user'\n",
    )
    .unwrap();
    for path in ["''", "missing.pem", "."] {
        let error = read(root.path(), &[], &[&format!("cache.tls_ca_file={path}")]).unwrap_err();
        assert!(matches!(error, ConfigError::Field { path, .. } if path == "cache.tls_ca_file"));
    }
    fs::write(root.path().join("ca.pem"), "certificate fixture").unwrap();
    let config = read(
        root.path(),
        &[],
        &[
            "cache.tls_ca_file=ca.pem",
            "cache.password_secret=cache.custom",
            "cache.tls=verify_ca",
            "cache.db=2",
        ],
    )
    .unwrap();
    let CacheConnection::Redis(remote) = &config.cache().connection else {
        panic!("redis")
    };
    assert_eq!(
        remote.tls_ca_file,
        Some(root.path().join("ca.pem").canonicalize().unwrap())
    );
    assert_eq!(remote.password_secret, "cache.custom");
    assert_eq!(remote.tls, TlsMode::VerifyCa);
    assert_eq!(remote.username.as_deref(), Some("user"));
    assert_eq!(remote.db, 2);
    for value in [
        "cache.username=''",
        "cache.username=' '",
        "cache.password_secret=Cache.bad",
        "cache.host=' '",
    ] {
        assert!(read(root.path(), &[], &[value]).is_err(), "{value}");
    }
}

#[test]
fn defaults_and_redis_fields_are_validated_before_use() {
    let root = tempfile::tempdir_in(std::env::temp_dir()).unwrap();
    let read = |items: &[&str]| {
        load(
            root.path(),
            [],
            &items.iter().map(|s| (*s).into()).collect::<Vec<_>>(),
        )
    };
    let local = read(&[]).unwrap().cache().clone();
    assert_eq!(local.provider(), CacheProvider::Local);
    assert_eq!(local.key_prefix, crate::identity::DEFAULT_CACHE_KEY_PREFIX);
    assert_eq!(local.local_capacity.get(), DEFAULT_LOCAL_CAPACITY);
    for item in [
        "host=localhost",
        "port=6379",
        "db=0",
        "username=default",
        "password_secret=cache.redis_password",
        "tls=verify_full",
        "tls_ca_file=ca.pem",
    ] {
        let override_ = format!("cache.{item}");
        let expected = override_.split('=').next().unwrap();
        assert!(
            matches!(read(&[&override_]).unwrap_err(), ConfigError::Field { path, .. } if path == expected)
        );
    }
    for (items, expected) in [
        (vec!["cache.provider=redis"], "cache.host"),
        (
            vec!["cache.provider=redis", "cache.host=localhost"],
            "cache.port",
        ),
        (
            vec![
                "cache.provider=redis",
                "cache.host=redis://user:secret@host",
                "cache.port=6379",
            ],
            "cache.host",
        ),
        (
            vec![
                "cache.provider=redis",
                "cache.host=localhost",
                "cache.port=0",
            ],
            "cache.port",
        ),
        (vec!["cache.local_capacity=0"], "cache.local_capacity"),
        (vec!["cache.key_prefix=bad:prefix"], "cache.key_prefix"),
        (
            vec![
                "cache.provider=redis",
                "cache.host=localhost",
                "cache.port=6379",
                "cache.db=-1",
            ],
            "cache.db",
        ),
        (
            vec![
                "cache.provider=redis",
                "cache.host=localhost",
                "cache.port=6379",
                "cache.tls=insecure",
            ],
            "cache.tls",
        ),
        (
            vec![
                "cache.provider=redis",
                "cache.host=localhost",
                "cache.port=6379",
                "cache.password_secret=bad",
            ],
            "cache.password_secret",
        ),
        (
            vec![
                "cache.provider=redis",
                "cache.host=localhost",
                "cache.port=6379",
                "cache.tls_ca_file=missing.pem",
            ],
            "cache.tls_ca_file",
        ),
    ] {
        assert!(
            matches!(read(&items).unwrap_err(), ConfigError::Field { path, .. } if path == expected),
            "{expected}"
        );
    }
    let config = read(&[
        "cache.provider=redis",
        "cache.host=localhost",
        "cache.port=6379",
    ])
    .unwrap()
    .cache()
    .clone();
    assert_eq!(config.location().as_deref(), Some("localhost:6379/0"));
    let CacheConnection::Redis(redis) = &config.connection else {
        panic!()
    };
    assert_eq!(redis.db, 0);
    assert_eq!(redis.tls, TlsMode::VerifyFull);
    assert!(redis.username.is_none());
    assert_eq!(redis.password_secret, "cache.redis_password");
}

#[test]
fn settings_write_preserves_cache_configuration() {
    let root = tempfile::tempdir_in(std::env::temp_dir()).unwrap();
    let text =
        "[cache]\nprovider = 'redis'\nhost = 'localhost'\nport = 6379\nkey_prefix = 'shared-app'\n";
    fs::write(root.path().join("config.toml"), text).unwrap();
    let mut config = load(root.path(), [], &[]).unwrap();
    config
        .update_settings(
            root.path(),
            &AppSettingsUpdate {
                theme: Some(Theme::Dark),
                ..Default::default()
            },
        )
        .unwrap();
    assert!(
        fs::read_to_string(root.path().join("config.toml"))
            .unwrap()
            .starts_with(text)
    );
    assert_eq!(
        load(root.path(), [], &[]).unwrap().cache().key_prefix,
        "shared-app"
    );
}
