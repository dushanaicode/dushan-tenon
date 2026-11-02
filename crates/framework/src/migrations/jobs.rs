use crate::db::migrate::{Dialect, create_table};
use sea_query::{ColumnDef, Index, IndexStatement, SchemaStatement, TableStatement};

pub(super) fn statements(dialect: Dialect) -> Vec<SchemaStatement> {
    let mut table = create_table(dialect, "fw_job");
    table.col(ColumnDef::new("id").string_len(36).not_null().primary_key());
    for (name, length) in [("kind", 128), ("module", 64), ("status", 16)] {
        table.col(ColumnDef::new(name).string_len(length).not_null());
    }
    table.col(ColumnDef::new("payload").text().not_null());
    for name in ["priority", "attempts", "max_attempts"] {
        table.col(ColumnDef::new(name).integer().not_null());
    }
    for name in ["retry_safe", "cancel_requested"] {
        table.col(ColumnDef::new(name).boolean().not_null());
    }
    for name in ["run_after", "created_at", "updated_at", "row_version"] {
        table.col(ColumnDef::new(name).big_integer().not_null());
    }
    for name in [
        "lease_expires_at",
        "progress_current",
        "progress_total",
        "started_at",
        "finished_at",
    ] {
        table.col(ColumnDef::new(name).big_integer());
    }
    for (name, length) in [
        ("lease_owner", 64),
        ("progress_message", 128),
        ("error_code", 128),
        ("submitted_by", 36),
    ] {
        table.col(ColumnDef::new(name).string_len(length));
    }
    for name in ["progress_params", "result", "error_params"] {
        table.col(ColumnDef::new(name).text());
    }
    let mut result = vec![SchemaStatement::TableStatement(TableStatement::Create(
        table,
    ))];
    for (name, columns) in [
        ("ix_fw_job_queue", vec!["status", "run_after", "priority"]),
        ("ix_fw_job_kind", vec!["kind"]),
        ("ix_fw_job_created_at", vec!["created_at"]),
    ] {
        let mut index = Index::create();
        index.name(name).table("fw_job");
        for column in columns {
            index.col(column);
        }
        result.push(SchemaStatement::IndexStatement(IndexStatement::Create(
            index,
        )));
    }
    result
}
