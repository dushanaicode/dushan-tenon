use sea_query::{ColumnDef, Index, IndexStatement, SchemaStatement, TableStatement};
use tenon_framework::db::migrate::{Dialect, create_table};

pub(super) fn statements(dialect: Dialect) -> Vec<SchemaStatement> {
    let mut statements = vec![
        SchemaStatement::TableStatement(TableStatement::Create(
            create_table(dialect, "notify_notification")
                .col(ColumnDef::new("id").string_len(36).not_null().primary_key())
                .col(ColumnDef::new("user_id").string_len(36).not_null())
                .col(ColumnDef::new("category").string_len(32).not_null())
                .col(ColumnDef::new("title_key").string_len(128).not_null())
                .col(ColumnDef::new("body_key").string_len(128).not_null())
                .col(ColumnDef::new("params").text().not_null())
                .col(ColumnDef::new("job_id").string_len(36))
                .col(ColumnDef::new("read_at").big_integer())
                .col(ColumnDef::new("created_at").big_integer().not_null())
                .to_owned(),
        )),
        SchemaStatement::TableStatement(TableStatement::Create(
            create_table(dialect, "notify_notification_delivery")
                .col(ColumnDef::new("id").string_len(36).not_null().primary_key())
                .col(ColumnDef::new("notification_id").string_len(36).not_null())
                .col(ColumnDef::new("channel").string_len(32).not_null())
                .col(ColumnDef::new("status").string_len(16).not_null())
                .col(ColumnDef::new("error_code").string_len(128))
                .col(ColumnDef::new("attempted_at").big_integer().not_null())
                .index(
                    Index::create()
                        .name("uq_notify_delivery_notification_channel")
                        .unique()
                        .col("notification_id")
                        .col("channel"),
                )
                .to_owned(),
        )),
    ];
    for column in ["read_at", "created_at"] {
        statements.push(SchemaStatement::IndexStatement(IndexStatement::Create(
            Index::create()
                .name(format!("ix_notify_notification_user_{column}"))
                .table("notify_notification")
                .col("user_id")
                .col(column)
                .to_owned(),
        )));
    }
    statements
}
