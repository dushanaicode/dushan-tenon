use crate::db::migrate::{Dialect, create_table};
use sea_query::{ColumnDef, Index, IndexStatement, SchemaStatement, TableStatement};

pub(super) fn statements(dialect: Dialect) -> Vec<SchemaStatement> {
    let mut table = create_table(dialect, "fw_file");
    table.col(ColumnDef::new("id").string_len(36).not_null().primary_key());
    for (name, length) in [
        ("instance_id", 36),
        ("purpose", 96),
        ("original_name", 255),
        ("extension", 16),
        ("sha256", 64),
        ("stored_path", 128),
        ("created_by", 36),
        ("updated_by", 36),
    ] {
        table.col(ColumnDef::new(name).string_len(length).not_null());
    }
    for name in ["size_bytes", "created_at", "updated_at", "row_version"] {
        table.col(ColumnDef::new(name).big_integer().not_null());
    }
    vec![
        SchemaStatement::TableStatement(TableStatement::Create(table)),
        SchemaStatement::IndexStatement(IndexStatement::Create(
            Index::create()
                .name("ix_fw_file_instance_created")
                .table("fw_file")
                .col("instance_id")
                .col("created_at")
                .to_owned(),
        )),
        SchemaStatement::IndexStatement(IndexStatement::Create(
            Index::create()
                .name("ix_fw_file_purpose")
                .table("fw_file")
                .col("purpose")
                .to_owned(),
        )),
    ]
}
