#![cfg(test)]

use std::num::NonZeroUsize;

use secrecy::{ExposeSecret, SecretString};
use tenon_framework::{
    db::{DatabaseConfig, DatabaseConnection, Db, RemoteDatabaseConfig},
    network::TlsMode,
    secret::{CredentialBackend, CredentialError, SecretStore},
};

struct NoSystemCredentials;
impl CredentialBackend for NoSystemCredentials {
    fn get(&self, _: &str) -> Result<SecretString, CredentialError> {
        panic!("TLS test requires an environment secret")
    }
    fn set(&self, _: &str, _: &SecretString) -> Result<(), CredentialError> {
        panic!("TLS test must not write credentials")
    }
    fn delete(&self, _: &str) -> Result<(), CredentialError> {
        panic!("TLS test must not delete credentials")
    }
}

#[tokio::test(flavor = "current_thread")]
#[ignore = "维护者提供 TENON_TEST_TLS_*、TENON__DATABASE__* 与数据库密码后运行"]
async fn remote_tls_modes_via_config_and_secret_store() {
    assert_eq!(std::env::var("TENON_TEST_TLS").as_deref(), Ok("1"));
    let root = tempfile::Builder::new()
        .prefix("remote-tls-")
        .tempdir_in(std::env::temp_dir())
        .unwrap();
    let store = SecretStore::with_backend(root.path(), NoSystemCredentials).unwrap();
    let password = SecretString::from(
        std::env::var("TENON_SECRET__DATABASE__PASSWORD").expect("missing test secret"),
    );
    let enabled = std::env::var("TENON_TEST_TLS_ENABLED").unwrap() == "enabled";
    let modes: &[TlsMode] = if enabled {
        &[TlsMode::Disabled, TlsMode::VerifyCa, TlsMode::VerifyFull]
    } else {
        &[TlsMode::Disabled]
    };
    for mode in modes {
        let remote = RemoteDatabaseConfig {
            host: std::env::var("TENON__DATABASE__HOST").unwrap(),
            port: std::env::var("TENON__DATABASE__PORT")
                .unwrap()
                .parse()
                .unwrap(),
            name: std::env::var("TENON__DATABASE__NAME").unwrap(),
            username: std::env::var("TENON__DATABASE__USERNAME").unwrap(),
            password_secret: "database.password".into(),
            tls: *mode,
            tls_ca_file: enabled.then(|| std::env::var("TENON_TEST_TLS_CA_FILE").unwrap().into()),
        };
        let connection = match std::env::var("TENON__DATABASE__KIND").unwrap().as_str() {
            "mysql" => DatabaseConnection::Mysql(remote),
            "postgres" => DatabaseConnection::Postgres(remote),
            _ => panic!("TLS test requires mysql or postgres"),
        };
        let config = DatabaseConfig {
            connection,
            backup_keep: NonZeroUsize::new(5).unwrap(),
        };
        let result = Db::connect(&config, &store, root.path()).await;
        assert!(
            !format!("{result:?}").contains(password.expose_secret()),
            "connection diagnostics leaked a secret"
        );
        if *mode == TlsMode::VerifyFull {
            let error = result.expect_err("resource certificates must not match 127.0.0.1");
            assert_eq!(error.to_string(), "app.database.tls_failed");
            println!(
                "{:?} {mode:?}: rejected mismatched certificate hostname",
                config.kind()
            );
        } else {
            result.unwrap().close().await;
            println!("{:?} {mode:?}: connected", config.kind());
        }
    }
}
