use super::*;
use crate::test_support::{Gate, start};
use tenon_framework::db::test_support;

struct Notifier;
impl DesktopNotifier for Notifier {
    fn send(&self, _: &str, _: &str) -> Result<(), AppError> {
        Ok(())
    }
    fn window_focused(&self) -> bool {
        false
    }
}

#[tokio::test]
async fn notify_declaration_start_stop_and_provider_resources_are_valid() {
    test_support::run(async |test| {
        let gate = Arc::new(Gate::default());
        let notifier = Arc::new(Notifier);
        let gate_weak = Arc::downgrade(&gate);
        let notifier_weak = Arc::downgrade(&notifier);
        let service = Arc::new(crate::test_support::notify(gate, notifier, Timestamp::now));
        assert_eq!(service.declaration().dependencies, ["account"]);
        assert_eq!(
            service.declaration().required_capabilities,
            [Capability::Job]
        );
        assert!(!service.declaration().core);
        assert!(service.declaration().permissions.is_empty());
        assert!(
            ERROR_CODES
                .iter()
                .all(|code| code.as_str().starts_with("notify."))
        );
        assert!(
            DICTIONARIES
                .iter()
                .all(|dict| dict.code.starts_with("notify."))
        );
        let account = Arc::downgrade(&service.account);
        let notify = Arc::downgrade(&service);
        let (registry, extensions, result) = start(
            test,
            vec![service.account.clone(), service.clone()],
            Arc::new(tenon_framework::i18n::TestTranslator),
        )
        .await;
        result.unwrap();
        assert_eq!(extensions.job_completion_hooks().len(), 1);
        registry.stop().await.unwrap();
        drop(extensions);
        drop(registry);
        drop(service);
        assert!(account.upgrade().is_none());
        assert!(notify.upgrade().is_none());
        assert!(gate_weak.upgrade().is_none());
        assert!(notifier_weak.upgrade().is_none());
    })
    .await;
}

#[tokio::test(flavor = "current_thread")]
async fn notify_logical_schema_matches_sqlite() {
    let mut migrations = tenon_framework::migrations::MIGRATIONS.to_vec();
    migrations.extend_from_slice(tenon_module_account::migrations::MIGRATIONS);
    migrations.extend_from_slice(migrations::MIGRATIONS);
    test_support::assert_migrated_schema(&migrations).await;
}

#[test]
fn all_module_migrations_have_the_expected_table_and_column_sets() {
    let migration = &migrations::MIGRATIONS[0];
    assert_eq!(migrations::MIGRATIONS.len(), 1);
    assert_eq!(
        (
            migration.info.module,
            migration.info.version,
            migration.info.name
        ),
        ("notify", 1, "create_notifications")
    );
    for dialect in tenon_framework::db::migrate::Dialect::ALL {
        let tables = migration
            .sql(dialect)
            .lines()
            .filter(|line| line.starts_with("CREATE TABLE"))
            .map(|line| {
                let table = line
                    .split_whitespace()
                    .nth(2)
                    .unwrap()
                    .trim_matches(['`', '"']);
                let columns = line
                    .split(" ( ")
                    .nth(1)
                    .unwrap()
                    .split(", ")
                    .filter_map(|part| {
                        let mut words = part.split_whitespace();
                        let name = words.next()?;
                        let kind = words.next()?;
                        (kind.starts_with("varchar(")
                            || ["text", "bigint", "integer", "int", "boolean", "bool"]
                                .contains(&kind))
                        .then(|| name.trim_matches(['`', '"']))
                    })
                    .collect::<Vec<_>>();
                (table, columns)
            })
            .collect::<std::collections::BTreeMap<_, _>>();
        assert_eq!(
            tables,
            std::collections::BTreeMap::from([
                (
                    "notify_notification",
                    vec![
                        "id",
                        "user_id",
                        "category",
                        "title_key",
                        "body_key",
                        "params",
                        "job_id",
                        "read_at",
                        "created_at"
                    ]
                ),
                (
                    "notify_notification_delivery",
                    vec![
                        "id",
                        "notification_id",
                        "channel",
                        "status",
                        "error_code",
                        "attempted_at"
                    ]
                ),
            ])
        );
    }
}
