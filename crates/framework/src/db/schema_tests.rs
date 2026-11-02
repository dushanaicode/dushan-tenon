use std::collections::{BTreeMap, BTreeSet};

use super::{
    Db,
    migrate::{Dialect, Migration},
    pool::Pool,
    test_support,
};

#[derive(Debug, PartialEq, Eq)]
enum LogicalType {
    IdText,
    Integer,
    Boolean,
    Text,
}

#[derive(Debug, PartialEq, Eq)]
struct Column {
    kind: LogicalType,
    nullable: bool,
}

#[derive(Debug, Default, PartialEq, Eq)]
struct Table {
    columns: BTreeMap<String, Column>,
    primary_key: BTreeSet<String>,
    unique: BTreeSet<BTreeSet<String>>,
}

type Schema = BTreeMap<String, Table>;

fn logical_type(value: &str) -> LogicalType {
    match value.to_ascii_lowercase().as_str() {
        "varchar(36)" => LogicalType::IdText,
        "bigint" | "integer" | "int" => LogicalType::Integer,
        "boolean" | "tinyint(1)" => LogicalType::Boolean,
        "text" => LogicalType::Text,
        value if value.starts_with("varchar(") => LogicalType::Text,
        value => panic!("unrecognized logical column type: {value}"),
    }
}

async fn schema(db: &Db) -> Schema {
    let mut result = Schema::new();
    let mut unique: BTreeMap<(String, String), BTreeSet<String>> = BTreeMap::new();
    match &db.pool {
        Pool::Sqlite(pool) => {
            let names: Vec<(String,)> = sqlx::query_as(
                "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
            )
            .fetch_all(pool)
            .await
            .unwrap();
            for (name,) in names {
                let mut table = Table::default();
                let quoted = name.replace('"', "\"\"");
                let columns: Vec<(i64, String, String, i64, Option<String>, i64)> = sqlx::query_as(
                    sqlx::AssertSqlSafe(format!("PRAGMA table_info(\"{quoted}\")")),
                )
                .fetch_all(pool)
                .await
                .unwrap();
                for (_, column, kind, not_null, _, primary) in columns {
                    if primary != 0 {
                        table.primary_key.insert(column.clone());
                    }
                    table.columns.insert(
                        column,
                        Column {
                            kind: logical_type(&kind),
                            nullable: not_null == 0,
                        },
                    );
                }
                let indexes: Vec<(i64, String, i64, String, i64)> = sqlx::query_as(
                    sqlx::AssertSqlSafe(format!("PRAGMA index_list(\"{quoted}\")")),
                )
                .fetch_all(pool)
                .await
                .unwrap();
                for (_, index, is_unique, origin, partial) in indexes {
                    if is_unique == 0 || origin == "pk" {
                        continue;
                    }
                    assert_eq!(partial, 0, "fixture must use portable, non-partial indexes");
                    let quoted = index.replace('"', "\"\"");
                    let columns: Vec<(i64, i64, String)> = sqlx::query_as(sqlx::AssertSqlSafe(
                        format!("PRAGMA index_info(\"{quoted}\")"),
                    ))
                    .fetch_all(pool)
                    .await
                    .unwrap();
                    table
                        .unique
                        .insert(columns.into_iter().map(|(_, _, column)| column).collect());
                }
                result.insert(name, table);
            }
        }
        Pool::Mysql(pool) => {
            let names: Vec<(String,)> = sqlx::query_as("SELECT table_name FROM information_schema.tables WHERE table_schema = DATABASE() AND table_type = 'BASE TABLE'").fetch_all(pool).await.unwrap();
            for (name,) in names {
                result.insert(name, Table::default());
            }
            let columns: Vec<(String, String, String, String)> = sqlx::query_as("SELECT table_name, column_name, column_type, is_nullable FROM information_schema.columns WHERE table_schema = DATABASE()").fetch_all(pool).await.unwrap();
            add_columns(&mut result, columns);
            let indexes: Vec<(String, String, String)> = sqlx::query_as("SELECT table_name, index_name, column_name FROM information_schema.statistics WHERE table_schema = DATABASE() AND non_unique = 0").fetch_all(pool).await.unwrap();
            for (table, index, column) in indexes {
                if index == "PRIMARY" {
                    result.get_mut(&table).unwrap().primary_key.insert(column);
                } else {
                    unique.entry((table, index)).or_default().insert(column);
                }
            }
        }
        Pool::Postgres(pool) => {
            let names: Vec<(String,)> = sqlx::query_as("SELECT table_name FROM information_schema.tables WHERE table_schema = current_schema() AND table_type = 'BASE TABLE'").fetch_all(pool).await.unwrap();
            for (name,) in names {
                result.insert(name, Table::default());
            }
            let columns: Vec<(String, String, String, String)> = sqlx::query_as("SELECT table_name, column_name, CASE WHEN data_type = 'character varying' THEN 'varchar(' || character_maximum_length || ')' ELSE data_type END, is_nullable FROM information_schema.columns WHERE table_schema = current_schema()").fetch_all(pool).await.unwrap();
            add_columns(&mut result, columns);
            let primary: Vec<(String, String)> = sqlx::query_as("SELECT k.table_name, k.column_name FROM information_schema.table_constraints t JOIN information_schema.key_column_usage k USING (constraint_catalog, constraint_schema, constraint_name, table_catalog, table_schema, table_name) WHERE t.table_schema = current_schema() AND t.constraint_type = 'PRIMARY KEY'").fetch_all(pool).await.unwrap();
            for (table, column) in primary {
                result.get_mut(&table).unwrap().primary_key.insert(column);
            }
            // information_schema 不枚举独立的唯一索引；补充 pg_catalog，涵盖约束与独立索引。
            let indexes: Vec<(String, String, String, bool)> = sqlx::query_as("SELECT t.relname::text, i.relname::text, a.attname::text, x.indpred IS NOT NULL FROM pg_index x JOIN pg_class t ON t.oid = x.indrelid JOIN pg_class i ON i.oid = x.indexrelid JOIN pg_namespace n ON n.oid = t.relnamespace JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(x.indkey) WHERE n.nspname = current_schema() AND x.indisunique AND NOT x.indisprimary").fetch_all(pool).await.unwrap();
            for (table, index, column, partial) in indexes {
                assert!(!partial, "fixture must use portable, non-partial indexes");
                unique.entry((table, index)).or_default().insert(column);
            }
        }
    }
    for ((table, _), columns) in unique {
        result.get_mut(&table).unwrap().unique.insert(columns);
    }
    result
}

fn add_columns(schema: &mut Schema, columns: Vec<(String, String, String, String)>) {
    for (table, name, kind, nullable) in columns {
        schema.get_mut(&table).unwrap().columns.insert(
            name,
            Column {
                kind: logical_type(&kind),
                nullable: nullable == "YES",
            },
        );
    }
}

pub async fn assert_migrated_schema(migrations: &[Migration]) {
    test_support::run(async |test| {
        test.upgrade(migrations, 1).await.unwrap();
        let actual = schema(&test.db).await;
        test_support::run_on(Dialect::Sqlite, async |reference| {
            reference.upgrade(migrations, 1).await.unwrap();
            let expected = schema(&reference.db).await;
            assert_eq!(
                actual,
                expected,
                "logical schema differs: {} vs sqlite",
                test.db.dialect().as_str()
            );
        })
        .await;
    })
    .await;
}

#[cfg(test)]
#[tokio::test(flavor = "current_thread")]
async fn migrated_logical_schema_matches_sqlite() {
    assert_migrated_schema(&super::migrate::tests::MIGRATIONS).await;
}
