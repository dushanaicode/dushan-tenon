//! 仅供快照生成工具与测试使用。历史 SQL 从磁盘读取，不重新渲染。

use std::{collections::BTreeMap, error::Error, fmt::Write as _, fs, io::Write as _, path::Path};

use sea_query::{
    MysqlQueryBuilder, PostgresQueryBuilder, SchemaStatement, SqliteQueryBuilder,
    backend::SchemaBuilder,
};

use super::{Dialect, MigrationInfo, checksum, validate_registry};

type Result<T> = std::result::Result<T, Box<dyn Error>>;
type Lock = BTreeMap<String, String>;
type Artifacts = BTreeMap<String, Vec<u8>>;

pub struct Definition {
    pub info: MigrationInfo,
    pub statements: fn(Dialect) -> Vec<SchemaStatement>,
}

fn render(statement: &SchemaStatement, builder: impl SchemaBuilder) -> Result<String> {
    Ok(match statement {
        SchemaStatement::TableStatement(statement) => statement.build(builder),
        SchemaStatement::IndexStatement(sea_query::IndexStatement::Create(statement)) => {
            statement.build(builder)
        }
        _ => return Err("unsupported migration schema statement".into()),
    })
}

const LOCK: &str = "sql-snapshots/lock.json";
const MANIFEST: &str = "src/migrations/snapshots.rs";

fn snapshot_path(info: MigrationInfo, dialect: Dialect) -> String {
    format!(
        "{}/{}/{:04}_{}.sql",
        dialect.as_str(),
        info.module,
        info.version,
        info.name
    )
}

fn read_lock(root: &Path) -> Result<Lock> {
    match fs::read(root.join(LOCK)) {
        Ok(bytes) => Ok(serde_json::from_slice(&bytes)?),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(Lock::new()),
        Err(error) => Err(error.into()),
    }
}

fn artifacts(root: &Path, definitions: &[Definition], allow_new: bool) -> Result<Artifacts> {
    validate_registry(definitions.iter().map(|definition| definition.info))?;
    let mut locked = read_lock(root)?;
    let mut expected_lock = Lock::new();
    let mut output = Artifacts::new();
    let mut manifest = String::from(
        "// 自动生成，勿手改。运行 pnpm db snapshot 更新。\n#[rustfmt::skip]\npub const MIGRATIONS: &[super::migrate::Migration] = &[\n",
    );
    for definition in definitions {
        let info = definition.info;
        writeln!(manifest, "    super::migrate::Migration {{")?;
        writeln!(
            manifest,
            "        info: super::migrate::MigrationInfo::new({:?}, {}, {:?}){},",
            info.module,
            info.version,
            info.name,
            if info.transactional {
                ""
            } else {
                ".non_transactional()"
            }
        )?;
        for dialect in Dialect::ALL {
            let relative = snapshot_path(info, dialect);
            let path = format!("sql-snapshots/{relative}");
            let stored = match fs::read(root.join(&path)) {
                Ok(bytes) => Some(bytes),
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
                Err(error) => return Err(error.into()),
            };
            let bytes = match (stored, locked.remove(&relative)) {
                (Some(bytes), Some(expected)) => {
                    if checksum(&bytes) != expected {
                        return Err(format!("snapshot checksum mismatch: {path}").into());
                    }
                    bytes
                }
                (None, None) if allow_new => {
                    let mut sql = String::new();
                    for statement in (definition.statements)(dialect) {
                        let rendered = match dialect {
                            Dialect::Sqlite => render(&statement, SqliteQueryBuilder)?,
                            Dialect::Mysql => render(&statement, MysqlQueryBuilder)?,
                            Dialect::Postgres => render(&statement, PostgresQueryBuilder)?,
                        };
                        writeln!(sql, "{rendered};")?;
                    }
                    sql.into_bytes()
                }
                (Some(_), None) => return Err(format!("snapshot has no lock entry: {path}").into()),
                (None, _) => return Err(format!("missing snapshot: {path}").into()),
            };
            expected_lock.insert(relative, checksum(&bytes));
            output.insert(path.clone(), bytes);
            writeln!(
                manifest,
                "        {}: include_str!(concat!(env!(\"CARGO_MANIFEST_DIR\"), \"/{path}\")),",
                dialect.as_str()
            )?;
        }
        writeln!(manifest, "    }},")?;
    }
    if !locked.is_empty() {
        return Err(format!(
            "lock entries have no migration definition: {:?}",
            locked.keys()
        )
        .into());
    }
    // 检出没有定义或锁定条目的遗留文件，不默默把它们排除在检查之外。
    let snapshots = root.join("sql-snapshots");
    if snapshots.exists() {
        check_files(root, &snapshots, &output)?;
    }
    manifest.push_str("];\n");
    output.insert(MANIFEST.into(), manifest.into_bytes());
    output.insert(
        LOCK.into(),
        format!("{}\n", serde_json::to_string_pretty(&expected_lock)?).into_bytes(),
    );
    Ok(output)
}

fn check_files(root: &Path, directory: &Path, expected: &Artifacts) -> Result<()> {
    for entry in fs::read_dir(directory)? {
        let entry = entry?;
        let path = entry.path();
        let kind = entry.file_type()?;
        if kind.is_dir() {
            check_files(root, &path, expected)?;
        } else {
            let relative = path
                .strip_prefix(root)?
                .to_str()
                .ok_or("snapshot path must be UTF-8")?
                .replace('\\', "/");
            if !kind.is_file() || (relative != LOCK && !expected.contains_key(&relative)) {
                return Err(format!("unregistered snapshot file: {relative}").into());
            }
        }
    }
    Ok(())
}

/// 只创建未锁定的新 SQL；已存在 SQL 必须摘要一致，且绝不打开写入。
pub fn generate(root: &Path, definitions: &[Definition]) -> Result<()> {
    let output = artifacts(root, definitions, true)?;
    // 先落新 SQL，再写锁与注册表；从不以新渲染覆盖历史文件。
    for (relative, bytes) in &output {
        if !relative.ends_with(".sql") {
            continue;
        }
        let path = root.join(relative);
        fs::create_dir_all(path.parent().ok_or("snapshot path has no parent")?)?;
        if !path.exists() {
            fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(path)?
                .write_all(bytes)?;
        }
    }
    for relative in [LOCK, MANIFEST] {
        let path = root.join(relative);
        fs::create_dir_all(path.parent().ok_or("snapshot path has no parent")?)?;
        if !path.exists() || fs::read(&path)? != output[relative] {
            fs::write(path, &output[relative])?;
        }
    }
    Ok(())
}

/// 调用者提供 Temp 下的独立 staging；全部生成到 staging 后逐字节比较。
pub fn check(root: &Path, definitions: &[Definition], staging: &Path) -> Result<()> {
    let output = artifacts(root, definitions, false)?;
    for (relative, bytes) in output {
        let path = staging.join(&relative);
        fs::create_dir_all(path.parent().ok_or("snapshot path has no parent")?)?;
        fs::write(&path, bytes)?;
        if fs::read(root.join(&relative))? != fs::read(path)? {
            return Err(
                format!("snapshot manifest drift: {relative}; run pnpm db snapshot").into(),
            );
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use sea_query::{ColumnDef, Table, TableStatement};

    fn definitions() -> [Definition; 2] {
        [
            Definition {
                info: MigrationInfo::new("fixture", 1, "create_items"),
                statements: |dialect| {
                    vec![SchemaStatement::TableStatement(TableStatement::Create(
                        super::super::create_table(dialect, "items")
                            .col(ColumnDef::new("id").integer().not_null().primary_key())
                            .to_owned(),
                    ))]
                },
            },
            Definition {
                info: MigrationInfo::new("fixture", 2, "add_label").non_transactional(),
                statements: |_| {
                    vec![SchemaStatement::TableStatement(TableStatement::Alter(
                        Table::alter()
                            .table("items")
                            .add_column(ColumnDef::new("label").text())
                            .to_owned(),
                    ))]
                },
            },
        ]
    }

    fn directory() -> tempfile::TempDir {
        tempfile::Builder::new()
            .prefix("snapshot-")
            .tempdir_in(std::env::temp_dir())
            .unwrap()
    }

    #[tokio::test(flavor = "current_thread")]
    async fn generated_fixture_snapshots_execute_without_calling_definitions() {
        use crate::db::{
            migrate::{self, Migration},
            test_support,
        };
        test_support::run(async |test| {
            let root = directory();
            let mut definitions = definitions();
            generate(root.path(), &definitions).unwrap();
            let migrations: Vec<_> = definitions
                .iter_mut()
                .map(|definition| {
                    definition.statements = |_| panic!("runtime cannot call definitions");
                    // 仅测试把生成文件装入进程生命周期；正式代码由 include_str! 提供静态引用。
                    let read = |dialect| -> &'static str {
                        Box::leak(
                            fs::read_to_string(
                                root.path()
                                    .join("sql-snapshots")
                                    .join(snapshot_path(definition.info, dialect)),
                            )
                            .unwrap()
                            .into_boxed_str(),
                        )
                    };
                    Migration {
                        info: definition.info,
                        sqlite: read(Dialect::Sqlite),
                        mysql: read(Dialect::Mysql),
                        postgres: read(Dialect::Postgres),
                    }
                })
                .collect();
            let report = test.upgrade(&migrations, 2).await.unwrap();
            assert_eq!(report.applied.len(), 2);
            test.raw("INSERT INTO items(id, label) VALUES (1, 'generated')")
                .await;
            assert_eq!(
                test.rows::<(String,)>("items", &["label"]).await,
                [("generated".to_owned(),)]
            );
            assert!(
                migrate::status(&test.db, &migrations)
                    .await
                    .unwrap()
                    .pending
                    .is_empty()
            );
        })
        .await;
    }

    #[test]
    fn generates_three_dialects_lock_and_runtime_manifest_without_rewriting_history() {
        let root = directory();
        let staging = directory();
        let mut definitions = definitions();
        generate(root.path(), &definitions[..1]).unwrap();
        let path = root
            .path()
            .join("sql-snapshots/sqlite/fixture/0001_create_items.sql");
        let before = fs::read(&path).unwrap();
        let modified = fs::metadata(&path).unwrap().modified().unwrap();
        definitions[0].statements = |_| panic!("existing migration must never be rendered again");
        generate(root.path(), &definitions).unwrap();
        assert_eq!(fs::read(&path).unwrap(), before);
        assert_eq!(fs::metadata(path).unwrap().modified().unwrap(), modified);
        let lock = read_lock(root.path()).unwrap();
        assert_eq!(lock.len(), 6);
        for dialect in Dialect::ALL {
            let relative = snapshot_path(definitions[1].info, dialect);
            let sql = fs::read(root.path().join("sql-snapshots").join(&relative)).unwrap();
            assert_eq!(lock[&relative], checksum(&sql));
            assert!(String::from_utf8(sql).unwrap().contains("ADD COLUMN"));
        }
        check(root.path(), &definitions, staging.path()).unwrap();
        let manifest = fs::read_to_string(root.path().join(MANIFEST)).unwrap();
        assert!(manifest.starts_with("// 自动生成，勿手改"));
        assert_eq!(manifest.matches("include_str!").count(), 6);
        assert!(manifest.contains(".non_transactional()"));
    }

    #[test]
    fn detects_modified_missing_unlocked_and_orphan_snapshots_and_manifest_drift() {
        for damage in ["modified", "missing", "unlocked", "orphan", "manifest"] {
            let root = directory();
            let staging = directory();
            let definitions = definitions();
            generate(root.path(), &definitions).unwrap();
            let path = root
                .path()
                .join("sql-snapshots/sqlite/fixture/0001_create_items.sql");
            match damage {
                "modified" => fs::write(path, "-- changed\n").unwrap(),
                "missing" => fs::remove_file(path).unwrap(),
                "unlocked" => fs::write(root.path().join(LOCK), "{}").unwrap(),
                "orphan" => {
                    fs::write(root.path().join("sql-snapshots/extra.sql"), "SELECT 1;").unwrap()
                }
                "manifest" => fs::write(root.path().join(MANIFEST), "// drift\n").unwrap(),
                _ => panic!("unknown fixture damage"),
            }
            assert!(
                check(root.path(), &definitions, staging.path()).is_err(),
                "{damage}"
            );
            if damage != "manifest" {
                assert!(generate(root.path(), &definitions).is_err(), "{damage}");
            }
        }
    }

    #[test]
    fn missing_new_migration_fails_check_and_invalid_metadata_cannot_write_paths() {
        let root = directory();
        let staging = directory();
        let mut definitions = definitions();
        generate(root.path(), &definitions[..1]).unwrap();
        assert!(check(root.path(), &definitions, staging.path()).is_err());
        definitions[1].info.version = 3;
        assert!(generate(root.path(), &definitions).is_err());
        definitions[1].info = MigrationInfo::new("../escape", 1, "bad");
        assert!(generate(root.path(), &definitions).is_err());
    }

    #[test]
    fn table_options_render_only_for_mysql() {
        use super::super::create_table;
        // 直接附加选项会污染其他方言，辅助函数必须按目标方言添加。
        let unfiltered = Table::create().table("items").engine("InnoDB").to_owned();
        assert!(
            unfiltered
                .build(SqliteQueryBuilder)
                .contains("ENGINE=InnoDB")
        );
        assert!(
            unfiltered
                .build(PostgresQueryBuilder)
                .contains("ENGINE=InnoDB")
        );
        for dialect in Dialect::ALL {
            let statement = create_table(dialect, "items")
                .col(ColumnDef::new("id").string_len(36).not_null().primary_key())
                .to_owned();
            let sql = crate::db::test_support::render(TableStatement::Create(statement), dialect);
            for option in [
                "ENGINE=InnoDB",
                "DEFAULT CHARSET=utf8mb4",
                "COLLATE=utf8mb4_bin",
            ] {
                assert_eq!(sql.contains(option), dialect == Dialect::Mysql, "{sql}");
            }
        }
    }
}
