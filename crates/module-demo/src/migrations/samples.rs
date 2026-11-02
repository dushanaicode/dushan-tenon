use sea_query::{
    ColumnDef, Expr, ExprTrait, Index, IndexStatement, SchemaStatement, TableStatement,
};
use tenon_framework::db::migrate::{Dialect, create_table};

pub(super) fn statements(dialect: Dialect) -> Vec<SchemaStatement> {
    vec![
        SchemaStatement::TableStatement(TableStatement::Create(
            create_table(dialect, "demo_sample")
                .col(ColumnDef::new("id").string_len(36).not_null().primary_key())
                .col(ColumnDef::new("created_by").string_len(36).not_null())
                .col(ColumnDef::new("created_at").big_integer().not_null())
                .col(ColumnDef::new("updated_at").big_integer().not_null())
                .col(ColumnDef::new("row_version").big_integer().not_null())
                .col(ColumnDef::new("code").string_len(32).not_null())
                .col(ColumnDef::new("title").string_len(120).not_null())
                .col(ColumnDef::new("note").text().not_null())
                .col(ColumnDef::new("stage").string_len(16).not_null())
                .col(ColumnDef::new("character_count").big_integer())
                .col(ColumnDef::new("attachment_id").string_len(36))
                .check(Expr::col("row_version").gte(1))
                .check(Expr::col("character_count").gte(0))
                .check(Expr::col("stage").is_in(["draft", "ready"]))
                .index(
                    Index::create()
                        .name("uq_demo_sample_owner_code")
                        .unique()
                        .col("created_by")
                        .col("code"),
                )
                .index(
                    Index::create()
                        .name("uq_demo_sample_attachment")
                        .unique()
                        .col("attachment_id"),
                )
                .to_owned(),
        )),
        SchemaStatement::IndexStatement(IndexStatement::Create(
            Index::create()
                .name("ix_demo_sample_owner_created")
                .table("demo_sample")
                .col("created_by")
                .col("created_at")
                .col("id")
                .to_owned(),
        )),
    ]
}
