use std::num::NonZeroU16;

use super::*;
use crate::secret::{CredentialBackend, CredentialError};

struct UnusedCredentials;
impl CredentialBackend for UnusedCredentials {
    fn get(&self, _: &str) -> Result<SecretString, CredentialError> {
        panic!("SQLite must not request credentials")
    }
    fn set(&self, _: &str, _: &SecretString) -> Result<(), CredentialError> {
        panic!("must not write credentials")
    }
    fn delete(&self, _: &str) -> Result<(), CredentialError> {
        panic!("must not delete credentials")
    }
}

#[tokio::test(flavor = "current_thread")]
async fn sqlite_connect_uses_config_without_credentials() {
    let root = tempfile::Builder::new()
        .prefix("sqlite-connect-")
        .tempdir_in(std::env::temp_dir())
        .unwrap();
    let secrets = SecretStore::with_backend(root.path(), UnusedCredentials).unwrap();
    let db = Db::connect(
        &DatabaseConfig {
            connection: DatabaseConnection::Sqlite,
            backup_keep: std::num::NonZeroUsize::new(5).unwrap(),
        },
        &secrets,
        root.path(),
    )
    .await
    .unwrap();
    assert!(root.path().join("data/app.db").is_file());
    assert_eq!(db.dialect(), crate::db::migrate::Dialect::Sqlite);
    db.close().await;
}

#[test]
fn remote_options_map_all_tls_modes_and_debug_redacts_password() {
    let password = SecretString::from("options-password-fixture");
    for (tls, mysql_mode, pg_mode) in [
        (
            TlsMode::Disabled,
            MySqlSslMode::Disabled,
            PgSslMode::Disable,
        ),
        (
            TlsMode::VerifyCa,
            MySqlSslMode::VerifyCa,
            PgSslMode::VerifyCa,
        ),
        (
            TlsMode::VerifyFull,
            MySqlSslMode::VerifyIdentity,
            PgSslMode::VerifyFull,
        ),
    ] {
        let config = RemoteDatabaseConfig {
            host: "db.example.test".into(),
            port: NonZeroU16::new(12345).unwrap(),
            name: "app_db".into(),
            username: "app_user".into(),
            password_secret: "database.password".into(),
            tls,
            tls_ca_file: Some("ca.pem".into()),
        };
        let mysql = RemoteOptions::mysql(&config, &password);
        let postgres = RemoteOptions::postgres(&config, &password).unwrap();
        assert!(!format!("{mysql:?} {postgres:?}").contains(password.expose_secret()));
        let RemoteOptions::Mysql(options) = mysql else {
            panic!("expected MySQL options")
        };
        assert_eq!(
            std::mem::discriminant(&options.get_ssl_mode()),
            std::mem::discriminant(&mysql_mode)
        );
        assert_eq!(options.get_host(), config.host);
        assert_eq!(options.get_port(), 12345);
        assert_eq!(options.get_database(), Some(config.name.as_str()));
        assert_eq!(options.get_username(), config.username);
        let RemoteOptions::Postgres(options) = postgres else {
            panic!("expected PostgreSQL options")
        };
        assert_eq!(
            std::mem::discriminant(&options.get_ssl_mode()),
            std::mem::discriminant(&pg_mode)
        );
        assert_eq!(options.get_host(), config.host);
        assert_eq!(options.get_port(), 12345);
        assert_eq!(options.get_database(), Some(config.name.as_str()));
        assert_eq!(options.get_username(), config.username);
    }
}

#[test]
fn connection_errors_never_retain_driver_messages() {
    for (error, code) in [
        (sqlx::Error::Tls("sensitive-fixture".into()), TLS_FAILED),
        (
            sqlx::Error::Io(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                "sensitive-fixture",
            )),
            TLS_FAILED,
        ),
        (
            sqlx::Error::Protocol("sensitive-fixture".into()),
            CONNECTION_FAILED,
        ),
    ] {
        let error = connection_error(error);
        assert_eq!(error.code, code);
        assert!(!format!("{error:?}").contains("sensitive-fixture"));
    }
}
