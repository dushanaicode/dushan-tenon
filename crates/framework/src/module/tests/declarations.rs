use super::*;

#[test]
fn invalid_ids_versions_and_errors_are_rejected_even_when_disabled() {
    const OTHER: ErrorCode = ErrorCode::new("other.test.failed");
    const FAILED: ErrorCode = ErrorCode::new("a.test.failed");
    for id in ["", "A", "1a", "a_b", "a-b", "app", "framework", "中文"] {
        assert!(matches!(
            ModuleRegistry::new(vec![module(id, &[], &Events::default())], &BTreeMap::new()),
            Err(RegistryError::InvalidId(_))
        ));
    }
    for enabled in [false, true] {
        for version in ["", " ", "\n"] {
            let mut a = module("a", &[], &Events::default());
            Arc::get_mut(&mut a).unwrap().declaration.version = version;
            assert!(
                matches!(ModuleRegistry::new(vec![a], &BTreeMap::from([("a".into(), enabled)])), Err(RegistryError::InvalidVersion(id)) if id == "a")
            );
        }
        for codes in [
            &[OTHER][..],
            &[FAILED, FAILED],
            &[crate::error::INTERNAL_UNEXPECTED],
        ] {
            let mut a = module("a", &[], &Events::default());
            Arc::get_mut(&mut a).unwrap().declaration.error_codes = codes;
            assert!(
                matches!(ModuleRegistry::new(vec![a], &BTreeMap::from([("a".into(), enabled)])), Err(RegistryError::InvalidErrorCode { module, .. }) if module == "a")
            );
        }
    }
}

#[test]
fn migration_metadata_uses_the_database_contract_before_collecting_extensions() {
    use crate::db::migrate::MigrationInfo;
    const FIRST: Migration = Migration {
        info: MigrationInfo::new("a", 1, "first"),
        sqlite: "",
        mysql: "",
        postgres: "",
    };
    for infos in [
        vec![MigrationInfo::new("other", 1, "first")],
        vec![MigrationInfo::new("a", 0, "first")],
        vec![MigrationInfo::new("a", 2, "second")],
        vec![MigrationInfo::new("a", 1, "Bad-Name")],
        vec![FIRST.info, FIRST.info],
    ] {
        for enabled in [false, true] {
            let mut a = module("a", &[], &Events::default());
            Arc::get_mut(&mut a).unwrap().declaration.migrations = Box::leak(
                infos
                    .iter()
                    .map(|info| Migration {
                        info: *info,
                        ..FIRST
                    })
                    .collect::<Vec<_>>()
                    .into_boxed_slice(),
            );
            assert!(
                matches!(ModuleRegistry::new(vec![a.clone()], &BTreeMap::from([("a".into(), enabled)])), Err(RegistryError::InvalidMigration { module, .. }) if module == "a")
            );
            assert_eq!(a.extension_calls.load(Ordering::SeqCst), 0);
        }
    }
}

#[test]
fn params_validate_metadata_and_js_integer_bounds() {
    use crate::param::{ParamDeclaration as D, ParamEffect, ParamKind as K};
    const LIMIT: i64 = 9_007_199_254_740_991;
    const VALID: D = D {
        key: "a.setting",
        kind: K::Integer {
            min: -LIMIT,
            max: LIMIT,
        },
        default: "0",
        group: "a.settings",
        order: 0,
        read_permission: Some("a.setting.read"),
        write_permission: Some("a.setting.write"),
        effect: ParamEffect::NextRead,
    };
    let check = |declaration: D, enabled| {
        let mut a = module("a", &[], &Events::default());
        let a_declaration = &mut Arc::get_mut(&mut a).unwrap().declaration;
        a_declaration.permissions = &["a.setting.read", "a.setting.write"];
        a_declaration.params = Box::leak(vec![declaration].into_boxed_slice());
        ModuleRegistry::new(vec![a], &BTreeMap::from([("a".into(), enabled)]))
    };
    for enabled in [true, false] {
        for default in ["-9007199254740991", "9007199254740991"] {
            assert!(check(D { default, ..VALID }, enabled).is_ok());
        }
        for invalid in [
            D {
                kind: K::Integer {
                    min: -LIMIT - 1,
                    max: LIMIT,
                },
                ..VALID
            },
            D {
                kind: K::Integer {
                    min: -LIMIT,
                    max: LIMIT + 1,
                },
                ..VALID
            },
            D {
                kind: K::Integer { min: 1, max: 0 },
                ..VALID
            },
            D {
                default: "9007199254740992",
                ..VALID
            },
            D {
                default: "-9007199254740992",
                ..VALID
            },
            D {
                group: "other.settings",
                ..VALID
            },
            D {
                group: "a.bad-name",
                ..VALID
            },
            D {
                group: "a",
                ..VALID
            },
            D {
                group: "a..settings",
                ..VALID
            },
            D {
                read_permission: Some("a.setting.missing"),
                ..VALID
            },
            D {
                write_permission: Some("other.setting.write"),
                ..VALID
            },
            D { order: -1, ..VALID },
        ] {
            assert!(
                matches!(
                    check(invalid, enabled),
                    Err(RegistryError::InvalidParam { module, key })
                        if module == "a" && key == "a.setting"
                ),
                "{invalid:?}, enabled={enabled}"
            );
        }
    }
}

#[test]
fn file_purposes_validate_prefix_uniqueness_extensions_and_derive_disabled_labels() {
    use crate::file::FilePurposeDeclaration as D;
    for (code, extensions) in [
        ("other.file", &["txt"][..]),
        ("a.bad-name", &["txt"]),
        ("a.file", &[]),
        ("a.file", &["txt", "txt"]),
        ("a.file", &["exe"]),
        ("a.file", &["TXT"]),
        ("a.file", &[".txt"]),
        ("a.file", &[""]),
        ("a.file", &["abcdefghijklmnopq"]),
    ] {
        let mut a = module("a", &[], &Events::default());
        Arc::get_mut(&mut a).unwrap().declaration.file_purposes =
            Box::leak(vec![D { code, extensions }].into_boxed_slice());
        assert!(
            matches!(
                ModuleRegistry::new(vec![a], &BTreeMap::new()),
                Err(RegistryError::InvalidFilePurpose { .. })
            ),
            "{code} {extensions:?}"
        );
    }
    let mut a = module("a", &[], &Events::default());
    Arc::get_mut(&mut a).unwrap().declaration.file_purposes = &[
        D {
            code: "a.file",
            extensions: &["txt"],
        },
        D {
            code: "a.file",
            extensions: &["png"],
        },
    ];
    assert!(matches!(
        ModuleRegistry::new(vec![a], &BTreeMap::new()),
        Err(RegistryError::InvalidFilePurpose { .. })
    ));
    let mut a = module("a", &[], &Events::default());
    Arc::get_mut(&mut a).unwrap().declaration.file_purposes = &[D {
        code: "a.file",
        extensions: crate::file::KNOWN_EXTENSIONS,
    }];
    let registry = ModuleRegistry::new(vec![a], &BTreeMap::from([("a".into(), false)])).unwrap();
    assert_eq!(registry.file_purposes().len(), 1);
    assert_eq!(
        registry.file_purpose_message_keys(),
        vec!["file.purpose.a.file"]
    );
    assert!(registry.message_keys().is_empty());
}

#[test]
fn params_validate_keys_defaults_ranges_and_prefix_collisions() {
    use crate::param::{ParamDeclaration as D, ParamKind as K};
    for (kind, default) in [
        (K::Text { max_chars: 0 }, ""),
        (K::Text { max_chars: 1025 }, ""),
        (K::Text { max_chars: 2 }, "abc"),
        (K::Text { max_chars: 2 }, "a\n"),
        (K::Integer { min: 2, max: 1 }, "1"),
        (K::Integer { min: -1, max: 2 }, "3"),
        (K::Integer { min: -1, max: 2 }, "-2"),
        (K::Integer { min: -1, max: 2 }, "1.0"),
        (K::Boolean, "TRUE"),
        (K::Boolean, "0"),
        (K::Choice { values: &[] }, ""),
        (
            K::Choice {
                values: &["x", "x"],
            },
            "x",
        ),
        (
            K::Choice {
                values: &["bad--value"],
            },
            "bad--value",
        ),
        (K::Choice { values: &["x"] }, "y"),
        (K::Secret, "source-secret"),
    ] {
        let mut a = module("a", &[], &Events::default());
        Arc::get_mut(&mut a).unwrap().declaration.params = Box::leak(
            vec![D {
                key: "a.value",
                kind,
                default,
                group: "a.settings",
                order: 0,
                read_permission: None,
                write_permission: None,
                effect: crate::param::ParamEffect::NextRead,
            }]
            .into_boxed_slice(),
        );
        assert!(matches!(
            ModuleRegistry::new(vec![a], &BTreeMap::new()),
            Err(RegistryError::InvalidParam { .. })
        ));
    }
    for key in [
        "other.value",
        "a",
        "a.",
        "a..value",
        "a.bad-name",
        "a.1value",
        "a.Upper",
        "a.value ",
        "a.中文",
        &format!("a.{}", "x".repeat(95)),
    ] {
        let mut a = module("a", &[], &Events::default());
        Arc::get_mut(&mut a).unwrap().declaration.params = Box::leak(
            vec![D {
                key: Box::leak(key.to_owned().into_boxed_str()),
                kind: K::Boolean,
                default: "false",
                group: "a.settings",
                order: 0,
                read_permission: None,
                write_permission: None,
                effect: crate::param::ParamEffect::NextRead,
            }]
            .into_boxed_slice(),
        );
        assert!(
            matches!(
                ModuleRegistry::new(vec![a], &BTreeMap::new()),
                Err(RegistryError::InvalidParam { .. })
            ),
            "{key}"
        );
    }
    for (first, second) in [("a.b", "a.b"), ("a.b", "a.b.c"), ("a.b.c", "a.b")] {
        let mut a = module("a", &[], &Events::default());
        Arc::get_mut(&mut a).unwrap().declaration.params = Box::leak(
            [first, second]
                .map(|key| D {
                    key,
                    kind: K::Boolean,
                    default: "true",
                    group: "a.settings",
                    order: 0,
                    read_permission: None,
                    write_permission: None,
                    effect: crate::param::ParamEffect::NextRead,
                })
                .to_vec()
                .into_boxed_slice(),
        );
        assert!(matches!(
            ModuleRegistry::new(vec![a], &BTreeMap::new()),
            Err(RegistryError::InvalidParam { .. })
        ));
    }
}

#[test]
fn dictionaries_validate_names_values_and_reserved_modules() {
    use crate::dict::{DictDeclaration, DictItemDeclaration, DictTone};
    const ITEM: DictItemDeclaration = DictItemDeclaration {
        value: "ready",
        tone: DictTone::Success,
    };
    for (code, items) in [
        ("other.status", vec![ITEM]),
        ("framework.job_status", vec![ITEM]),
        ("a.bad-name", vec![ITEM]),
        ("a.status", vec![]),
        ("a.status", vec![ITEM, ITEM]),
        (
            "a.status",
            vec![DictItemDeclaration {
                value: "bad-value",
                ..ITEM
            }],
        ),
        (
            "a.status",
            vec![DictItemDeclaration {
                value: "1value",
                ..ITEM
            }],
        ),
    ] {
        let mut a = module("a", &[], &Events::default());
        Arc::get_mut(&mut a).unwrap().declaration.dictionaries = Box::leak(
            vec![DictDeclaration {
                code,
                items: Box::leak(items.into_boxed_slice()),
            }]
            .into_boxed_slice(),
        );
        assert!(
            matches!(
                ModuleRegistry::new(vec![a], &BTreeMap::new()),
                Err(RegistryError::InvalidDictionary { .. })
            ),
            "{code}"
        );
    }
    let mut a = module("a", &[], &Events::default());
    let declaration = DictDeclaration {
        code: "a.status",
        items: &[ITEM],
    };
    Arc::get_mut(&mut a).unwrap().declaration.dictionaries =
        Box::leak(vec![declaration, declaration].into_boxed_slice());
    assert!(matches!(
        ModuleRegistry::new(vec![a], &BTreeMap::new()),
        Err(RegistryError::InvalidDictionary { .. })
    ));
    for reserved in ["app", "framework"] {
        assert!(matches!(
            ModuleRegistry::new(
                vec![module(reserved, &[], &Events::default())],
                &BTreeMap::new()
            ),
            Err(RegistryError::InvalidId(_))
        ));
    }
}

#[test]
fn permissions_validate_format_prefix_duplicates_and_topological_order() {
    let events = Events::default();
    for key in [
        "",
        "a.b",
        "a.b.c.d",
        "a..read",
        "a.role.Read",
        "a.role.read-now",
        "a.role.读",
        "other.role.read",
    ] {
        let mut a = module("a", &[], &events);
        Arc::get_mut(&mut a).unwrap().declaration.permissions =
            Box::leak(vec![key].into_boxed_slice());
        assert!(
            matches!(
                ModuleRegistry::new(vec![a], &BTreeMap::new()),
                Err(RegistryError::InvalidPermission { .. })
            ),
            "{key}"
        );
    }
    let mut a = module("a", &[], &events);
    Arc::get_mut(&mut a).unwrap().declaration.permissions = &["a.role.read", "a.role.read"];
    assert!(matches!(
        ModuleRegistry::new(vec![a], &BTreeMap::new()),
        Err(RegistryError::DuplicatePermission(_))
    ));
    let mut a = module("a", &[], &events);
    Arc::get_mut(&mut a).unwrap().declaration.permissions = &["a.role.read", "a.role_2.write"];
    let mut b = module("b", &["a"], &events);
    Arc::get_mut(&mut b).unwrap().declaration.permissions = &["b.1._"];
    let registry = ModuleRegistry::new(vec![b, a], &BTreeMap::from([("b".into(), false)])).unwrap();
    assert_eq!(
        registry.permissions(),
        ["a.role.read", "a.role_2.write", "b.1._"]
    );
}

#[test]
fn message_keys_accept_only_module_or_consumed_shared_prefixes() {
    for (id, keys) in [
        (
            "notify",
            &[
                "notify.job.succeeded.title",
                "jobs.kinds.demo.done",
                "errors.demo.failed",
                "exchange.progress.writing",
            ][..],
        ),
        ("example", &["example.roles.admin"][..]),
        ("sample", &["sample.message.title"][..]),
    ] {
        let mut entry = module(id, &[], &Events::default());
        Arc::get_mut(&mut entry).unwrap().declaration.message_keys = keys;
        let registry = ModuleRegistry::new(vec![entry], &BTreeMap::new()).unwrap();
        assert_eq!(registry.message_keys(), keys);
    }
    for (id, key) in [
        ("notify", "notifications.job.done"),
        ("example", "roles.admin"),
        ("notify", "sample.message.title"),
        ("sample", "notify.job.succeeded.title"),
    ] {
        for enabled in [true, false] {
            let mut entry = module(id, &[], &Events::default());
            Arc::get_mut(&mut entry).unwrap().declaration.message_keys =
                Box::leak(vec![key].into_boxed_slice());
            assert!(
                matches!(
                    ModuleRegistry::new(vec![entry], &BTreeMap::from([(id.into(), enabled)])),
                    Err(RegistryError::InvalidMessageKey { .. })
                ),
                "{id}: {key}, enabled={enabled}"
            );
        }
    }
}
