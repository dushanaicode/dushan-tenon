use crate::db::migrate::{Dialect, create_table};
use sea_query::{ColumnDef, Index, IndexStatement, SchemaStatement, TableStatement};

pub(super) fn statements(dialect: Dialect) -> Vec<SchemaStatement> {
    let mut table = create_table(dialect, "fw_param");
    table.col(ColumnDef::new("id").string_len(36).not_null().primary_key());
    table.col(ColumnDef::new("param_key").string_len(96).not_null());
    table.col(ColumnDef::new("value").string_len(1024));
    table.col(
        ColumnDef::new("secret_set")
            .boolean()
            .not_null()
            .default(false),
    );
    for name in ["created_at", "updated_at", "row_version"] {
        table.col(ColumnDef::new(name).big_integer().not_null());
    }
    for name in ["created_by", "updated_by"] {
        table.col(ColumnDef::new(name).string_len(36).not_null());
    }
    vec![
        SchemaStatement::TableStatement(TableStatement::Create(table)),
        SchemaStatement::IndexStatement(IndexStatement::Create(
            Index::create()
                .name("ux_fw_param_key")
                .table("fw_param")
                .col("param_key")
                .unique()
                .to_owned(),
        )),
    ]
}
