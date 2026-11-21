use super::*;
use tenon_framework::{db::migrate::MigrationInfo, secret::MemoryCredentials};

fn temporary() -> tempfile::TempDir {
    tempfile::tempdir_in(std::env::var_os("TEMP").expect("isolated TEMP")).unwrap()
}

fn no_secrets(_: &Path) -> Result<ProxySecrets, AppError> {
    panic!("声明导出或未确认升级不得构造秘密后端")
}

#[test]
fn cli_preserves_repeated_options_and_rejects_wrong_positions_and_unknown_dialect() {
    let cli = Cli::try_parse_from([
        "cli",
        "db",
        "status",
        "--set",
        "logging.level=debug",
        "--state-root",
        "Temp/cli-test",
        "--set",
        "database.backup_keep=2",
    ])
    .unwrap();
    let Command::Db {
        command: DbCommand::Status(options),
    } = cli.command
    else {
        panic!("expected status")
    };
    assert_eq!(options.state_root, Some("Temp/cli-test".into()));
    assert_eq!(
        options.overrides,
        ["logging.level=debug", "database.backup_keep=2"]
    );
    for args in [
        vec!["cli", "--set", "logging.level=debug", "db", "status"],
        vec!["cli", "db", "export-sql", "--dialect", "oracle"],
        vec![
            "cli",
            "db",
            "status",
            "--database-url",
            "mysql://localhost/db",
        ],
        vec!["cli", "db", "upgrade", "--password", "secret-sentinel"],
    ] {
        assert!(Cli::try_parse_from(args).is_err());
    }
    assert_eq!(
        Cli::try_parse_from(["cli", "--help"]).err().unwrap().kind(),
        clap::error::ErrorKind::DisplayHelp
    );
}

#[tokio::test]
async fn export_sql_stdout_and_file_preserve_registration_order_without_database() {
    let migrations = [
        Migration {
            info: MigrationInfo::new("z_module", 1, "first"),
            sqlite: "SELECT 1;",
            mysql: "SELECT 11;",
            postgres: "SELECT 111;",
        },
        Migration {
            info: MigrationInfo::new("a_module", 1, "second"),
            sqlite: "SELECT 2;",
            mysql: "SELECT 22;",
            postgres: "SELECT 222;",
        },
    ];
    let root = temporary();
    for (dialect, expected) in [
        ("sqlite", "SELECT 1;\nSELECT 2;"),
        ("mysql", "SELECT 11;\nSELECT 22;"),
        ("postgres", "SELECT 111;\nSELECT 222;"),
    ] {
        let cli = Cli::try_parse_from(["cli", "db", "export-sql", "--dialect", dialect]).unwrap();
        let mut output = Vec::new();
        execute(cli, &migrations, no_secrets, &mut output)
            .await
            .unwrap();
        assert_eq!(output, expected.as_bytes());
        let file = root.path().join(format!("{dialect}.sql"));
        let cli = Cli::try_parse_from([
            "cli",
            "db",
            "export-sql",
            "--dialect",
            dialect,
            "--out",
            file.to_str().unwrap(),
        ])
        .unwrap();
        output.clear();
        execute(cli, &migrations, no_secrets, &mut output)
            .await
            .unwrap();
        assert!(output.is_empty());
        assert_eq!(fs::read_to_string(file).unwrap(), expected);
    }
    assert!(!root.path().join("data").exists());
}

#[tokio::test]
async fn compiled_declarations_export_all_three_ddl_dialects_without_services() {
    let migrations = dushan_tenon_lib::modules::migrations();
    for (dialect, quotes) in [("sqlite", '"'), ("mysql", '`'), ("postgres", '"')] {
        let cli = Cli::try_parse_from(["cli", "db", "export-sql", "--dialect", dialect]).unwrap();
        let mut output = Vec::new();
        execute(cli, &migrations, no_secrets, &mut output)
            .await
            .unwrap();
        let sql = String::from_utf8(output).unwrap();
        assert!(sql.contains("CREATE TABLE"));
        for name in ["fw_job", "account_user", "notify_notification"] {
            assert!(
                sql.contains(&format!("{quotes}{name}{quotes}")),
                "{dialect}: {name}"
            );
        }
    }
}

#[tokio::test]
async fn cli_remote_upgrade_requires_backup_confirmation_before_secrets_or_connection() {
    let root = temporary();
    for kind in ["mysql", "postgres"] {
        fs::write(root.path().join("config.toml"),format!("[database]\nkind='{kind}'\nhost='127.0.0.1'\nport=1\nname='unreachable'\nusername='user'\n")).unwrap();
        let cli = Cli::try_parse_from([
            "cli",
            "db",
            "upgrade",
            "--state-root",
            root.path().to_str().unwrap(),
        ])
        .unwrap();
        let mut output = Vec::new();
        let error = execute(cli, &[], no_secrets, &mut output)
            .await
            .unwrap_err();
        assert!(error.to_string().contains("--confirm-backup"));
        assert!(output.is_empty());
    }
    assert!(Cli::try_parse_from(["cli", "db", "upgrade", "--confirm-backup"]).is_ok());
}

#[tokio::test]
async fn status_and_upgrade_report_categories_and_failure_exit_codes() {
    let root = temporary();
    let config = config::load(root.path(), [], &[]).unwrap();
    let secrets = SecretStore::with_backend(root.path(), MemoryCredentials::default()).unwrap();
    let migrations = dushan_tenon_lib::modules::migrations();
    let mut output = Vec::new();
    assert_eq!(
        result_code(
            run_database(
                false,
                false,
                root.path(),
                config.database(),
                &secrets,
                &migrations,
                &mut output
            )
            .await
        ),
        ExitCode::SUCCESS
    );
    let report: serde_json::Value = serde_json::from_slice(&output).unwrap();
    for key in [
        "applied",
        "pending",
        "unknown",
        "checksum_mismatch",
        "failed",
    ] {
        assert!(report[key].is_array());
    }
    assert_eq!(
        report["pending"].as_array().unwrap().len(),
        migrations.len()
    );
    output.clear();
    assert_eq!(
        result_code(
            run_database(
                true,
                false,
                root.path(),
                config.database(),
                &secrets,
                &migrations,
                &mut output
            )
            .await
        ),
        ExitCode::SUCCESS
    );
    let report: serde_json::Value = serde_json::from_slice(&output).unwrap();
    assert_eq!(
        report["applied"].as_array().unwrap().len(),
        migrations.len()
    );
    output.clear();
    assert_eq!(
        result_code(
            run_database(
                false,
                false,
                root.path(),
                config.database(),
                &secrets,
                &[],
                &mut output
            )
            .await
        ),
        ExitCode::FAILURE
    );
    let report: serde_json::Value = serde_json::from_slice(&output).unwrap();
    assert_eq!(
        report["unknown"].as_array().unwrap().len(),
        migrations.len()
    );
    assert!(tenon_desktop::database::path(root.path()).is_file());
}
