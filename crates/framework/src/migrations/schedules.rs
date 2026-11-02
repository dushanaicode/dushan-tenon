use crate::db::migrate::{Dialect, create_table};
use sea_query::{ColumnDef, Index, IndexStatement, SchemaStatement, TableStatement};

pub(super) fn statements(dialect: Dialect) -> Vec<SchemaStatement> {
    let mut table = create_table(dialect, "fw_job_schedule");
    table.col(ColumnDef::new("id").string_len(36).not_null().primary_key());
    for (name, length) in [("key", 128), ("kind", 128), ("cron", 128), ("timezone", 64)] {
        table.col(ColumnDef::new(name).string_len(length).not_null());
    }
    table.col(ColumnDef::new("payload").text().not_null());
    table.col(ColumnDef::new("enabled").boolean().not_null());
    for name in ["next_run_at", "last_run_at"] {
        table.col(ColumnDef::new(name).big_integer());
    }
    for name in ["last_job_id", "updated_by"] {
        table.col(ColumnDef::new(name).string_len(36));
    }
    for name in ["created_at", "updated_at", "row_version"] {
        table.col(ColumnDef::new(name).big_integer().not_null());
    }
    vec![
        SchemaStatement::TableStatement(TableStatement::Create(table)),
        SchemaStatement::IndexStatement(IndexStatement::Create(
            Index::create()
                .name("ux_fw_job_schedule_key")
                .table("fw_job_schedule")
                .col("key")
                .unique()
                .to_owned(),
        )),
        SchemaStatement::IndexStatement(IndexStatement::Create(
            Index::create()
                .name("ix_fw_job_schedule_due")
                .table("fw_job_schedule")
                .col("enabled")
                .col("next_run_at")
                .to_owned(),
        )),
    ]
}
