//! database 行为测试。

use super::*;

#[test]
fn database_config_validates_kind_and_positive_retention_and_override_precedence() {
    let root = state_root();
    fs::write(
        root.path().join("config.toml"),
        "[database]\nkind = 'sqlite'\nbackup_keep = 2\n",
    )
    .unwrap();
    let loaded = read(
        root.path(),
        &[("TENON__DATABASE__BACKUP_KEEP", "3")],
        &["database.backup_keep=4"],
    )
    .unwrap();
    assert_eq!(loaded.database().backup_keep.get(), 4);
    for value in [
        "database.backup_keep=0",
        "database.backup_keep=-1",
        "database.backup_keep=1.5",
        "database.kind=mysql",
        "database.kind=postgres",
        "database.unknown=1",
    ] {
        assert!(read(root.path(), &[], &[value]).is_err(), "{value}");
    }
}

#[test]
fn remote_database_required_fields_defaults_overrides_and_tls_are_validated() {
    let root = state_root();
    for kind in ["mysql", "postgres"] {
        let base = format!(
            "[database]\nkind = '{kind}'\nhost = 'localhost'\nport = 1234\nname = 'app'\nusername = 'owner'\n"
        );
        fs::write(root.path().join("config.toml"), &base).unwrap();
        let loaded = read(
            root.path(),
            &[("TENON__DATABASE__PORT", "2345")],
            &["database.username=cli_owner"],
        )
        .unwrap();
        let (DatabaseConnection::Mysql(remote) | DatabaseConnection::Postgres(remote)) =
            loaded.database().connection.clone()
        else {
            panic!("remote")
        };
        assert_eq!(remote.port.get(), 2345);
        assert_eq!(remote.username, "cli_owner");
        assert_eq!(remote.password_secret, "database.password");
        assert_eq!(remote.tls, TlsMode::VerifyFull);
        for (key, line) in [
            ("host", "host = 'localhost'\n"),
            ("port", "port = 1234\n"),
            ("name", "name = 'app'\n"),
            ("username", "username = 'owner'\n"),
        ] {
            fs::write(root.path().join("config.toml"), base.replace(line, "")).unwrap();
            assert!(
                matches!(read(root.path(), &[], &[]).unwrap_err(), ConfigError::Field { path, .. } if path == format!("database.{key}"))
            );
        }
        fs::write(root.path().join("config.toml"), &base).unwrap();
        for value in ["disabled", "verify_ca", "verify_full"] {
            assert!(read(root.path(), &[], &[&format!("database.tls={value}")]).is_ok());
        }
        for (key, value) in [
            ("tls", "required"),
            ("tls", "prefer"),
            ("tls", "skip_verify"),
            ("port", "0"),
            ("port", "65536"),
            ("host", "''"),
            ("host", "mysql://user:password@host"),
            ("username", "''"),
            ("name", "''"),
            ("password_secret", "Database.password"),
            ("password", "forbidden"),
        ] {
            assert!(
                matches!(read(root.path(), &[], &[&format!("database.{key}={value}")]).unwrap_err(), ConfigError::Field { path, .. } if path == format!("database.{key}"))
            );
        }
    }
}

#[test]
fn sqlite_rejects_every_remote_field_even_explicit_defaults() {
    let root = state_root();
    for (key, value) in [
        ("host", "localhost"),
        ("port", "3306"),
        ("name", "app"),
        ("username", "owner"),
        ("password_secret", "database.password"),
        ("tls", "verify_full"),
        ("tls_ca_file", "ca.pem"),
    ] {
        assert!(
            matches!(read(root.path(), &[], &[&format!("database.{key}={value}")]).unwrap_err(), ConfigError::Field { path, .. } if path == format!("database.{key}"))
        );
    }
}

#[test]
fn ca_path_is_resolved_from_state_root_and_must_be_a_readable_file() {
    let root = state_root();
    fs::write(
        root.path().join("config.toml"),
        "[database]\nkind='postgres'\nhost='localhost'\nport=5432\nname='app'\nusername='owner'\n",
    )
    .unwrap();
    for path in ["''", "missing.pem", "."] {
        assert!(
            matches!(read(root.path(), &[], &[&format!("database.tls_ca_file={path}")]).unwrap_err(), ConfigError::Field { path, .. } if path == "database.tls_ca_file")
        );
    }
    fs::write(root.path().join("ca.pem"), "certificate fixture").unwrap();
    let config = read(root.path(), &[], &["database.tls_ca_file=ca.pem"]).unwrap();
    let DatabaseConnection::Postgres(remote) = config.database().connection.clone() else {
        panic!("expected PostgreSQL connection")
    };
    assert_eq!(
        remote.tls_ca_file,
        Some(root.path().join("ca.pem").canonicalize().unwrap())
    );
}
