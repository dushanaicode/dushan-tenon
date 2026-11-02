use crate::db::migrate::Dialect;
use sea_query::{ColumnDef, SchemaStatement, Table, TableStatement};

pub(super) fn statements(_: Dialect) -> Vec<SchemaStatement> {
    vec![SchemaStatement::TableStatement(TableStatement::Alter(
        Table::alter()
            .table("fw_job")
            .add_column(ColumnDef::new("instance_id").string_len(36))
            .to_owned(),
    ))]
}
