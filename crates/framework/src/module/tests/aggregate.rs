use super::*;

#[test]
fn framework_error_codes_are_unique_three_part_app_codes_and_include_job_outcomes() {
    let codes: BTreeSet<_> = ERROR_CODES.iter().copied().collect();
    assert_eq!(codes.len(), ERROR_CODES.len());
    assert_eq!(codes.len(), 54);
    for code in codes {
        assert!(crate::error::is_valid_code(code.as_str()), "{code}");
        assert!(code.as_str().starts_with("app."), "{code}");
    }
    for code in [
        crate::job::INVALID_STATE,
        crate::error::JOB_CANCELLED,
        MODULE_DISABLED,
    ] {
        assert_eq!(ERROR_CODES.iter().filter(|&&c| c == code).count(), 1);
    }
    let mut a = module("a", &[], &Events::default());
    const FAILED: ErrorCode = ErrorCode::new("a.test.failed");
    Arc::get_mut(&mut a).unwrap().declaration.error_codes = &[FAILED];
    let registry = ModuleRegistry::new(vec![a], &BTreeMap::from([("a".into(), false)])).unwrap();
    let all: Vec<_> = registry.error_codes().collect();
    assert_eq!(&all[..ERROR_CODES.len()], ERROR_CODES);
    assert_eq!(all.last().unwrap().as_str(), "a.test.failed");
    assert_eq!(all.iter().collect::<BTreeSet<_>>().len(), all.len());
}

#[test]
fn builtin_dictionaries_have_unique_codes_and_valid_unique_values() {
    assert_eq!(BUILTIN.len(), 3);
    let mut codes = BTreeSet::new();
    for dictionary in BUILTIN {
        assert!(crate::dict::valid_code(dictionary.code, "framework"));
        assert!(codes.insert(dictionary.code));
        assert!(!dictionary.items.is_empty());
        let mut values = BTreeSet::new();
        for item in dictionary.items {
            assert!(crate::dict::valid_value(item.value));
            assert!(values.insert(item.value));
        }
    }
}

#[test]
fn params_include_disabled_modules_and_derive_names_descriptions_and_choices() {
    use crate::param::{ParamDeclaration as D, ParamKind as K};
    let mut a = module("a", &[], &Events::default());
    Arc::get_mut(&mut a).unwrap().declaration.params = &[
        D {
            key: "a.text",
            kind: K::Text { max_chars: 1 },
            default: "中",
            group: "a.settings",
            order: 0,
            read_permission: None,
            write_permission: None,
            effect: crate::param::ParamEffect::NextRead,
        },
        D {
            key: "a.integer",
            kind: K::Integer {
                min: -9_007_199_254_740_991,
                max: 9_007_199_254_740_991,
            },
            default: "-9007199254740991",
            group: "a.settings",
            order: 0,
            read_permission: None,
            write_permission: None,
            effect: crate::param::ParamEffect::NextRead,
        },
        D {
            key: "a.boolean",
            kind: K::Boolean,
            default: "true",
            group: "a.settings",
            order: 0,
            read_permission: None,
            write_permission: None,
            effect: crate::param::ParamEffect::NextRead,
        },
        D {
            key: "a.secret",
            kind: K::Secret,
            default: "",
            group: "a.settings",
            order: 0,
            read_permission: None,
            write_permission: None,
            effect: crate::param::ParamEffect::NextRead,
        },
        D {
            key: "a.group.choice",
            kind: K::Choice {
                values: &["one", "two"],
            },
            default: "one",
            group: "a.settings",
            order: 0,
            read_permission: None,
            write_permission: None,
            effect: crate::param::ParamEffect::NextRead,
        },
        D {
            key: "a.group.choices",
            kind: K::Boolean,
            default: "false",
            group: "a.settings",
            order: 0,
            read_permission: None,
            write_permission: None,
            effect: crate::param::ParamEffect::NextRead,
        },
    ];
    let registry = ModuleRegistry::new(vec![a], &BTreeMap::from([("a".into(), false)])).unwrap();
    assert_eq!(registry.params().len(), 6);
    let keys = registry.param_message_keys();
    assert_eq!(keys.len(), 15);
    for key in [
        "param.group.a.settings",
        "param.a.text.name",
        "param.a.text.description",
        "param.a.group.choice.choice.one",
        "param.a.group.choice.choice.two",
    ] {
        assert!(keys.iter().any(|k| k == key));
    }
    assert!(registry.message_keys().is_empty());
}

#[test]
fn dictionary_declarations_and_derived_keys_include_disabled_modules_in_order() {
    use crate::dict::{DictDeclaration, DictItemDeclaration, DictTone};
    let events = Events::default();
    let mut a = module("a", &[], &events);
    Arc::get_mut(&mut a).unwrap().declaration.dictionaries = &[DictDeclaration {
        code: "a.group.status",
        items: &[
            DictItemDeclaration {
                value: "ready",
                tone: DictTone::Success,
            },
            DictItemDeclaration {
                value: "waiting",
                tone: DictTone::Info,
            },
        ],
    }];
    let mut b = module("b", &["a"], &events);
    Arc::get_mut(&mut b).unwrap().declaration.dictionaries = &[DictDeclaration {
        code: "b.status",
        items: &[DictItemDeclaration {
            value: "ready",
            tone: DictTone::Success,
        }],
    }];
    let registry = ModuleRegistry::new(vec![b, a], &BTreeMap::from([("b".into(), false)])).unwrap();
    assert_eq!(
        registry
            .dictionaries()
            .iter()
            .map(|dict| dict.code)
            .collect::<Vec<_>>(),
        [
            "framework.exchange_format",
            "framework.job_status",
            "framework.cache_status",
            "a.group.status",
            "b.status"
        ]
    );
    assert_eq!(
        registry.dictionary_message_keys(),
        [
            "dict.framework.exchange_format",
            "dict.framework.exchange_format.xlsx",
            "dict.framework.exchange_format.csv",
            "dict.framework.exchange_format.json",
            "dict.framework.job_status",
            "dict.framework.job_status.queued",
            "dict.framework.job_status.running",
            "dict.framework.job_status.succeeded",
            "dict.framework.job_status.failed",
            "dict.framework.job_status.cancelled",
            "dict.framework.job_status.needs_review",
            "dict.framework.cache_status",
            "dict.framework.cache_status.connected",
            "dict.framework.cache_status.error",
            "dict.a.group.status",
            "dict.a.group.status.ready",
            "dict.a.group.status.waiting",
            "dict.b.status",
            "dict.b.status.ready"
        ]
    );
    assert_eq!(&registry.dictionaries()[..BUILTIN.len()], BUILTIN);
    assert!(registry.message_keys().is_empty());
}

#[test]
fn backend_message_keys_reject_foreign_prefixes_and_include_disabled_modules() {
    let events = Events::default();
    for key in ["", "a", "other.body", "jobs.", "jobs..title"] {
        let mut a = module("a", &[], &events);
        Arc::get_mut(&mut a).unwrap().declaration.message_keys =
            Box::leak(vec![key].into_boxed_slice());
        assert!(
            matches!(
                ModuleRegistry::new(vec![a], &BTreeMap::new()),
                Err(RegistryError::InvalidMessageKey { .. })
            ),
            "{key}"
        );
    }
    let mut a = module("a", &[], &events);
    Arc::get_mut(&mut a).unwrap().declaration.message_keys = &[
        "a.done",
        "exchange.progress.done",
        "jobs.kinds.sample.cleanup",
        "errors.a.job.failed",
        "a.templates.test.subject",
    ];
    let registry = ModuleRegistry::new(vec![a], &BTreeMap::from([("a".into(), false)])).unwrap();
    assert_eq!(
        registry.message_keys(),
        [
            "a.done",
            "exchange.progress.done",
            "jobs.kinds.sample.cleanup",
            "errors.a.job.failed",
            "a.templates.test.subject"
        ]
    );
}

#[test]
fn migrations_include_disabled_modules_in_dependency_and_version_order() {
    use crate::db::migrate::MigrationInfo;
    const A: Migration = Migration {
        info: MigrationInfo::new("a", 1, "first"),
        sqlite: "",
        mysql: "",
        postgres: "",
    };
    const B1: Migration = Migration {
        info: MigrationInfo::new("b", 1, "first"),
        ..A
    };
    const B2: Migration = Migration {
        info: MigrationInfo::new("b", 2, "second"),
        ..A
    };
    let events = Events::default();
    let mut a = module("a", &[], &events);
    Arc::get_mut(&mut a).unwrap().declaration.migrations = &[A];
    let mut b = module("b", &["a"], &events);
    Arc::get_mut(&mut b).unwrap().declaration.migrations = &[B2, B1];
    let registry = ModuleRegistry::new(vec![b, a], &BTreeMap::from([("b".into(), false)])).unwrap();
    assert_eq!(
        registry
            .migrations()
            .iter()
            .map(|m| (m.info.module, m.info.version))
            .collect::<Vec<_>>(),
        [
            ("framework", 1),
            ("framework", 2),
            ("framework", 3),
            ("framework", 4),
            ("framework", 5),
            ("a", 1),
            ("b", 1),
            ("b", 2)
        ]
    );
    assert_eq!(
        registry.guard("b_user_get").unwrap_err().code(),
        MODULE_DISABLED
    );
    registry.guard("app_any_command").unwrap();
    assert!(registry.guard("missing_user_get").is_err());
}
