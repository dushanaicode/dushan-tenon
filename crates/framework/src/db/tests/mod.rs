use sea_query::{ColumnDef, Expr, ExprTrait, Index, Query, TableStatement};
use sqlx::FromRow;

use super::migrate::{Dialect, create_table};
use super::test_support::{self, TestDb};
use super::*;
use crate::error::{DATA_NOT_FOUND, DATA_VERSION_CONFLICT, INTERNAL_UNEXPECTED};
use crate::{
    actor::{Actor, ExecutionContext},
    id::Id,
    time::Timestamp,
};

mod bindings;
mod crud;
mod page;
mod soft_delete;
mod transactions;

const RECORDS: Table = Table {
    name: "records",
    audit: true,
    soft_delete: true,
    optimistic_lock: true,
};

enum Schema {
    Records,
    Typed,
    Bindings,
    Numbers,
    PlainSoft,
    ForeignKeys,
}

async fn setup(test: &TestDb, schema: Schema) {
    let dialect = test.db.dialect();
    let statements = match schema {
        Schema::Records => vec![
            create_table(dialect, "records")
                .col(ColumnDef::new("id").string_len(36).not_null().primary_key())
                .col(ColumnDef::new("business_key").string_len(128).not_null())
                .col(ColumnDef::new("created_at").big_integer().not_null())
                .col(ColumnDef::new("created_by").string_len(36).not_null())
                .col(ColumnDef::new("updated_at").big_integer().not_null())
                .col(ColumnDef::new("updated_by").string_len(36).not_null())
                .col(ColumnDef::new("deleted_at").big_integer())
                .col(ColumnDef::new("delete_token").string_len(36).not_null())
                .col(ColumnDef::new("row_version").big_integer().not_null())
                .index(
                    Index::create()
                        .name("records_business_key")
                        .col("business_key")
                        .col("delete_token")
                        .unique(),
                )
                .to_owned(),
        ],
        Schema::Typed => vec![
            create_table(dialect, "typed")
                .col(ColumnDef::new("id").string_len(36).not_null())
                .col(ColumnDef::new("at").big_integer().not_null())
                .to_owned(),
        ],
        Schema::Bindings => vec![
            create_table(dialect, "bindings")
                .col(ColumnDef::new("seq").big_integer().not_null().primary_key())
                .col(ColumnDef::new("flag").boolean())
                .col(ColumnDef::new("number").big_integer())
                .col(ColumnDef::new("real").double())
                .col(ColumnDef::new("text").text())
                .col(ColumnDef::new("bytes").blob())
                .to_owned(),
        ],
        Schema::Numbers => vec![
            create_table(dialect, "numbers")
                .col(ColumnDef::new("seq").big_integer())
                .col(ColumnDef::new("value").big_integer())
                .to_owned(),
        ],
        Schema::PlainSoft => vec![
            create_table(dialect, "plain")
                .col(ColumnDef::new("id").string_len(36).not_null().primary_key())
                .col(ColumnDef::new("business_key").text().not_null())
                .to_owned(),
            create_table(dialect, "soft")
                .col(ColumnDef::new("id").string_len(36).not_null().primary_key())
                .col(ColumnDef::new("business_key").text().not_null())
                .col(ColumnDef::new("deleted_at").big_integer())
                .col(ColumnDef::new("delete_token").string_len(36).not_null())
                .to_owned(),
        ],
        Schema::ForeignKeys => {
            test.raw("CREATE TABLE parent(id INTEGER PRIMARY KEY); CREATE TABLE child(parent_id INTEGER REFERENCES parent(id));").await;
            vec![]
        }
    };
    for statement in statements {
        test.raw(&test_support::render(
            TableStatement::Create(statement),
            dialect,
        ))
        .await;
    }
}

fn context() -> ExecutionContext {
    ExecutionContext::new(Actor::System, Id::new().to_string())
}

async fn insert_record(db: &Db, key: &str) -> Id {
    db.insert(RECORDS, &context(), [("business_key", key.into())])
        .await
        .unwrap()
}

#[derive(Debug, FromRow)]
struct Record {
    id: Id,
    business_key: String,
    created_at: Timestamp,
    created_by: String,
    updated_at: Timestamp,
    updated_by: String,
    deleted_at: Option<Timestamp>,
    delete_token: String,
    row_version: i64,
}

async fn record(db: &Db, id: Id) -> Record {
    let mut query = Query::select()
        .from(RECORDS.name)
        .column(sea_query::Asterisk)
        .to_owned();
    query.and_where(Expr::col("id").eq(id));
    db.fetch_optional(&query).await.unwrap().unwrap()
}
