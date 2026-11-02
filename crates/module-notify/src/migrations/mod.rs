use tenon_framework::db::migrate;

mod snapshots;
pub use snapshots::MIGRATIONS;

#[cfg(test)]
mod notifications;

#[cfg(test)]
fn definitions() -> Vec<migrate::snapshot::Definition> {
    vec![migrate::snapshot::Definition {
        info: migrate::MigrationInfo::new("notify", 1, "create_notifications"),
        statements: notifications::statements,
    }]
}

#[cfg(test)]
mod tests;
