use tenon_framework::db::migrate;

mod snapshots;
pub use snapshots::MIGRATIONS;

#[cfg(test)]
fn definitions() -> Vec<migrate::snapshot::Definition> {
    use migrate::{MigrationInfo, create_table, snapshot::Definition};
    use sea_query::{ColumnDef, Index, IndexStatement, SchemaStatement, TableStatement};

    vec![Definition {
        info: MigrationInfo::new("account", 1, "create_account"),
        statements: |dialect| {
            vec![
                SchemaStatement::TableStatement(TableStatement::Create(
                    create_table(dialect, "account_user")
                        .col(ColumnDef::new("id").string_len(36).not_null().primary_key())
                        .col(ColumnDef::new("display_name").string_len(128).not_null())
                        .col(ColumnDef::new("password_hash").text())
                        .col(ColumnDef::new("created_at").big_integer().not_null())
                        .col(ColumnDef::new("created_by").string_len(36).not_null())
                        .col(ColumnDef::new("updated_at").big_integer().not_null())
                        .col(ColumnDef::new("updated_by").string_len(36).not_null())
                        .col(ColumnDef::new("row_version").big_integer().not_null())
                        .to_owned(),
                )),
                SchemaStatement::TableStatement(TableStatement::Create(
                    create_table(dialect, "account_auth_setting")
                        .col(ColumnDef::new("id").string_len(36).not_null().primary_key())
                        .col(ColumnDef::new("mode").string_len(16).not_null())
                        .col(ColumnDef::new("created_at").big_integer().not_null())
                        .col(ColumnDef::new("created_by").string_len(36).not_null())
                        .col(ColumnDef::new("updated_at").big_integer().not_null())
                        .col(ColumnDef::new("updated_by").string_len(36).not_null())
                        .col(ColumnDef::new("row_version").big_integer().not_null())
                        .to_owned(),
                )),
                SchemaStatement::TableStatement(TableStatement::Create(
                    create_table(dialect, "account_recovery_code")
                        .col(ColumnDef::new("id").string_len(36).not_null().primary_key())
                        .col(ColumnDef::new("user_id").string_len(36).not_null())
                        .col(ColumnDef::new("code_hash").text().not_null())
                        .col(ColumnDef::new("used_at").big_integer())
                        .col(ColumnDef::new("created_at").big_integer().not_null())
                        .col(ColumnDef::new("created_by").string_len(36).not_null())
                        .col(ColumnDef::new("updated_at").big_integer().not_null())
                        .col(ColumnDef::new("updated_by").string_len(36).not_null())
                        .col(ColumnDef::new("deleted_at").big_integer())
                        .col(ColumnDef::new("delete_token").string_len(36).not_null())
                        .to_owned(),
                )),
                SchemaStatement::IndexStatement(IndexStatement::Create(
                    Index::create()
                        .name("ix_account_recovery_code_user_id")
                        .table("account_recovery_code")
                        .col("user_id")
                        .to_owned(),
                )),
                SchemaStatement::TableStatement(TableStatement::Create(
                    create_table(dialect, "account_login_attempt")
                        .col(ColumnDef::new("user_id").string_len(36).not_null())
                        .col(ColumnDef::new("failed_count").integer().not_null())
                        .col(ColumnDef::new("last_failed_at").big_integer().not_null())
                        .col(ColumnDef::new("locked_until").big_integer())
                        .index(
                            Index::create()
                                .name("uq_account_login_attempt_user_id")
                                .unique()
                                .col("user_id"),
                        )
                        .to_owned(),
                )),
            ]
        },
    }]
}

#[cfg(test)]
mod tests;
