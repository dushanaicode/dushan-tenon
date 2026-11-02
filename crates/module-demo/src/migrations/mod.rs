use tenon_framework::db::migrate;

mod snapshots;
pub use snapshots::MIGRATIONS;

#[cfg(test)]
mod drafts;
#[cfg(test)]
mod samples;

#[cfg(test)]
fn definitions() -> Vec<migrate::snapshot::Definition> {
    vec![
        migrate::snapshot::Definition {
            info: migrate::MigrationInfo::new("demo", 1, "create_demo"),
            statements: samples::statements,
        },
        migrate::snapshot::Definition {
            info: migrate::MigrationInfo::new("demo", 2, "sample_drafts"),
            statements: drafts::statements,
        },
    ]
}

#[cfg(test)]
mod tests;
