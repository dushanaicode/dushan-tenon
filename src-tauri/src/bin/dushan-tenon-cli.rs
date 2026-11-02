use clap::{Args, Parser, Subcommand};
use std::{
    error::Error,
    fs,
    io::{self, Write},
    path::{Path, PathBuf},
    process::ExitCode,
};
use tenon_desktop::{config, identity::CREDENTIAL_SERVICE, state_root};
use tenon_framework::{
    db::{
        DatabaseConfig, DatabaseKind, Db,
        migrate::{self, Dialect, Migration},
    },
    error::AppError,
    network::ProxySecrets,
    secret::{CredentialBackend, SecretStore},
};

#[derive(Parser)]
#[command(
    version,
    about = "Dushan Tenon 数据库工具",
    after_help = "使用 --state-root <PATH> 或 TENON_STATE_ROOT 选择配置与凭据命名空间。远端 upgrade 必须传 --confirm-backup。参数放在最终子命令之后。"
)]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    /// 三库版本检查、升级与 SQL 导出。
    Db {
        #[command(subcommand)]
        command: DbCommand,
    },
}

#[derive(Args)]
struct StartupOptions {
    #[arg(long, value_name = "PATH")]
    state_root: Option<PathBuf>,
    #[arg(long = "set", value_name = "段.键=值")]
    overrides: Vec<String>,
}

#[derive(Subcommand)]
enum DbCommand {
    /// 输出五种迁移状态，异常返回 1。
    Status(StartupOptions),
    /// SQLite 自动备份；远端需要显式确认。
    Upgrade {
        #[command(flatten)]
        options: StartupOptions,
        #[arg(long)]
        confirm_backup: bool,
    },
    /// 从纯声明导出，不读取配置或秘密，不连接数据库。
    ExportSql {
        #[arg(long, value_name = "sqlite|mysql|postgres")]
        dialect: Dialect,
        #[arg(long, value_name = "FILE")]
        out: Option<PathBuf>,
    },
}

async fn execute(
    cli: Cli,
    migrations: &[Migration],
    secrets: impl FnOnce(&Path) -> Result<ProxySecrets, AppError>,
    output: &mut impl Write,
) -> Result<(), Box<dyn Error>> {
    let Command::Db { command } = cli.command;
    let (options, upgrade, confirm_backup) = match command {
        DbCommand::Status(options) => (options, false, false),
        DbCommand::Upgrade {
            options,
            confirm_backup,
        } => (options, true, confirm_backup),
        DbCommand::ExportSql { dialect, out } => {
            let sql = migrate::export_sql(migrations, dialect)?;
            if let Some(path) = out {
                fs::write(path, sql)?;
            } else {
                output.write_all(sql.as_bytes())?;
            }
            return Ok(());
        }
    };
    let root = state_root::resolve(options.state_root, || {
        Err(state_root::StateRootError::MissingRoot.into())
    })?;
    let config = config::load(&root, std::env::vars(), &options.overrides)?;
    require_backup(upgrade, confirm_backup, config.database().kind())?;
    run_database(
        upgrade,
        confirm_backup,
        &root,
        config.database(),
        &secrets(&root)?,
        migrations,
        output,
    )
    .await
}

fn require_backup(
    upgrade: bool,
    confirm_backup: bool,
    kind: DatabaseKind,
) -> Result<(), Box<dyn Error>> {
    if upgrade && kind != DatabaseKind::Sqlite && !confirm_backup {
        return Err("MySQL/PostgreSQL 升级需要 --confirm-backup，表示已自行备份".into());
    }
    Ok(())
}

async fn run_database(
    upgrade: bool,
    confirm_backup: bool,
    root: &Path,
    config: &DatabaseConfig,
    secrets: &SecretStore<impl CredentialBackend>,
    migrations: &[Migration],
    output: &mut impl Write,
) -> Result<(), Box<dyn Error>> {
    require_backup(upgrade, confirm_backup, config.kind())?;
    let db = Db::connect(config, secrets, root).await?;
    let report = if upgrade {
        let backup = if config.kind() == DatabaseKind::Sqlite {
            migrate::UpgradeBackup::Sqlite {
                state_root: root,
                keep: config.backup_keep,
            }
        } else {
            migrate::UpgradeBackup::Confirmed
        };
        migrate::upgrade(&db, migrations, backup).await
    } else {
        migrate::status(&db, migrations).await
    };
    db.close().await;
    let report = report?;
    serde_json::to_writer_pretty(&mut *output, &report)?;
    writeln!(output)?;
    report.ensure_upgradeable()?;
    Ok(())
}

fn result_code(result: Result<(), Box<dyn Error>>) -> ExitCode {
    match result {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("命令失败: {error}");
            ExitCode::FAILURE
        }
    }
}

#[tokio::main(flavor = "current_thread")]
async fn main() -> ExitCode {
    let cli = Cli::parse();
    result_code(
        execute(
            cli,
            &dushan_tenon_lib::modules::migrations(),
            |root| Ok(SecretStore::new(root, CREDENTIAL_SERVICE)?.boxed()),
            &mut io::stdout().lock(),
        )
        .await,
    )
}

#[cfg(test)]
#[path = "../cli_tests.rs"]
mod tests;
