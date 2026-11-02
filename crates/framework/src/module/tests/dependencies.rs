use super::*;

#[test]
fn declarations_are_read_only_topological_and_include_disabled_modules() {
    let events = Events::default();
    let mut a = module("a", &[], &events);
    Arc::get_mut(&mut a).unwrap().declaration.core = true;
    let b = module("b", &["a"], &events);
    let registry = ModuleRegistry::new(
        vec![b.clone(), a.clone()],
        &BTreeMap::from([("b".into(), false)]),
    )
    .unwrap();
    for _ in 0..2 {
        let declarations = registry.declarations().collect::<Vec<_>>();
        assert_eq!(
            declarations
                .iter()
                .map(|declaration| (declaration.id, declaration.dependencies, declaration.core))
                .collect::<Vec<_>>(),
            [("a", &[][..], true), ("b", &["a"][..], false)]
        );
        assert!(std::ptr::eq(declarations[0], &a.declaration));
        assert!(std::ptr::eq(declarations[1], &b.declaration));
        assert_eq!(a.extension_calls.load(Ordering::SeqCst), 1);
        assert_eq!(b.extension_calls.load(Ordering::SeqCst), 1);
        assert!(events.lock().unwrap().is_empty());
    }
}

#[test]
fn rejects_duplicate_missing_and_cyclic_dependencies() {
    let events = Events::default();
    let duplicate = ModuleRegistry::new(
        vec![module("a", &[], &events), module("a", &[], &events)],
        &BTreeMap::new(),
    );
    assert!(matches!(duplicate, Err(RegistryError::Duplicate(id)) if id == "a"));
    let missing = ModuleRegistry::new(vec![module("a", &["missing"], &events)], &BTreeMap::new());
    assert!(
        matches!(missing, Err(RegistryError::MissingDependency { module, dependency }) if module == "a" && dependency == "missing")
    );
    let cycle = ModuleRegistry::new(
        vec![module("a", &["b"], &events), module("b", &["a"], &events)],
        &BTreeMap::new(),
    );
    assert!(matches!(cycle, Err(RegistryError::Cycle(_))));
}

#[test]
fn rejects_disabled_core_dependency_and_unknown_module_settings() {
    let events = Events::default();
    for case in ["core", "dependency", "unknown"] {
        let mut a = module("a", &[], &events);
        Arc::get_mut(&mut a).unwrap().declaration.core = case == "core";
        let settings = BTreeMap::from([(
            if case == "unknown" { "missing" } else { "a" }.to_owned(),
            false,
        )]);
        let result = ModuleRegistry::new(vec![a, module("b", &["a"], &events)], &settings);
        match result {
            Err(RegistryError::CoreDisabled(id)) => {
                assert_eq!(case, "core");
                assert_eq!(id, "a");
            }
            Err(RegistryError::DisabledDependency { module, dependency }) => {
                assert_eq!(case, "dependency");
                assert_eq!(module, "b");
                assert_eq!(dependency, "a");
            }
            Err(RegistryError::UnknownModule(id)) => {
                assert_eq!(case, "unknown");
                assert_eq!(id, "missing");
            }
            _ => panic!("expected registry error for {case}"),
        }
    }
}

#[test]
fn capabilities_are_required_only_for_enabled_modules() {
    for enabled in [false, true] {
        let mut a = module("a", &[], &Events::default());
        Arc::get_mut(&mut a)
            .unwrap()
            .declaration
            .required_capabilities = &[Capability::Job, Capability::Exchange, Capability::File];
        let registry =
            ModuleRegistry::new(vec![a], &BTreeMap::from([("a".into(), enabled)])).unwrap();
        let capabilities = [Capability::Job, Capability::Exchange, Capability::File];
        for missing in capabilities {
            let available: Vec<_> = capabilities
                .into_iter()
                .filter(|capability| *capability != missing)
                .collect();
            match registry.check_capabilities(&available) {
                Err(RegistryError::CapabilityUnavailable { module, capability }) => {
                    assert!(enabled);
                    assert_eq!(module, "a");
                    assert_eq!(capability, missing);
                }
                Ok(()) => assert!(!enabled),
                result => panic!("{result:?}"),
            }
        }
        registry.check_capabilities(&capabilities).unwrap();
    }
}
