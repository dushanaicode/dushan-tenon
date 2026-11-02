use sea_query::{ColumnDef, Expr, ExprTrait, Index, SchemaStatement, TableStatement};
use tenon_framework::db::migrate::{Dialect, create_table};

pub(super) fn statements(dialect: Dialect) -> Vec<SchemaStatement> {
    vec![SchemaStatement::TableStatement(TableStatement::Create(
        create_table(dialect, "demo_sample_draft")
            .col(ColumnDef::new("id").string_len(36).not_null().primary_key())
            .col(ColumnDef::new("created_by").string_len(36).not_null())
            .col(ColumnDef::new("target_key").string_len(36).not_null())
            .col(ColumnDef::new("sample_id").string_len(36))
            .col(ColumnDef::new("base_version").big_integer())
            .col(ColumnDef::new("session_id").string_len(36).not_null())
            .col(ColumnDef::new("revision").big_integer().not_null())
            .col(ColumnDef::new("code").string_len(32).not_null())
            .col(ColumnDef::new("title").string_len(120).not_null())
            .col(ColumnDef::new("note").text().not_null())
            .col(ColumnDef::new("has_changes").boolean().not_null())
            .col(ColumnDef::new("updated_at").big_integer().not_null())
            .check(Expr::col("revision").gte(0))
            .check(Expr::col("base_version").gte(1))
            .index(
                Index::create()
                    .name("uq_demo_draft_owner_target")
                    .unique()
                    .col("created_by")
                    .col("target_key"),
            )
            .to_owned(),
    ))]
}
