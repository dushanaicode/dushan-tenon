use super::*;

#[test]
fn each_identity_slot_is_required_without_a_default() {
    for missing in ["actor_resolver", "permission_checker", "permission_lookup"] {
        let a = module("a", &[], &Events::default());
        let mut extensions = identity_extensions(&Arc::new(Provider::default()));
        match missing {
            "actor_resolver" => extensions.actor_resolver = None,
            "permission_checker" => extensions.permission_checker = None,
            "permission_lookup" => extensions.permission_lookup = None,
            _ => panic!("unexpected test case"),
        }
        *a.extensions.lock().unwrap() = extensions;
        let b = module("b", &[], &Events::default());
        *b.extensions.lock().unwrap() = identity_extensions(&Arc::new(Provider::default()));
        let frozen = ModuleRegistry::new(vec![a, b], &BTreeMap::from([("b".into(), false)]))
            .unwrap()
            .freeze(vec![]);
        assert!(matches!(frozen, Err(RegistryError::MissingProvider { slot }) if slot == missing));
    }
}

#[test]
fn single_providers_are_bound_once_without_runtime_calls() {
    let mut a = module("a", &[], &Events::default());
    let provider = Arc::new(Provider::default());
    let a_mut = Arc::get_mut(&mut a).unwrap();
    a_mut.declaration.job_kinds = &["a.job"];
    let mut extensions = identity_extensions(&provider);
    extensions.job_handlers.push(provider.clone());
    extensions.job_completion_hooks.push(provider.clone());
    *a_mut.extensions.get_mut().unwrap() = extensions;
    let registry = ModuleRegistry::new(vec![a.clone()], &BTreeMap::new()).unwrap();
    assert_eq!(a.extension_calls.load(Ordering::SeqCst), 1);
    assert_eq!(provider.0.load(Ordering::SeqCst), 0);
    let frozen = registry.freeze(vec![]).unwrap();
    let identity = frozen.identity();
    assert!(Arc::ptr_eq(
        &identity.actor_resolver,
        &(provider.clone() as Arc<dyn ActorResolver>)
    ));
    assert!(Arc::ptr_eq(
        &identity.permission_checker,
        &(provider.clone() as Arc<dyn PermissionChecker>)
    ));
    assert!(Arc::ptr_eq(
        &identity.permission_lookup,
        &(provider.clone() as Arc<dyn PermissionLookup>)
    ));
    assert!(Arc::ptr_eq(
        &frozen.job_handlers()[0],
        &(provider.clone() as Arc<dyn JobHandler>)
    ));
    assert!(Arc::ptr_eq(
        &frozen.job_completion_hooks()[0],
        &(provider.clone() as Arc<dyn JobCompletionHook>)
    ));
    assert_eq!(a.extension_calls.load(Ordering::SeqCst), 1);
    assert_eq!(provider.0.load(Ordering::SeqCst), 0);
}

#[test]
fn duplicate_single_slots_report_every_provider_in_dependency_order() {
    for slot in ["actor_resolver", "permission_checker", "permission_lookup"] {
        for count in [2, 3] {
            let mut modules: Vec<Arc<dyn Module>> = Vec::new();
            for (id, dependencies) in [("b", &["a"][..]), ("a", &[][..]), ("c", &[][..])]
                .into_iter()
                .take(count)
            {
                let module = module(id, dependencies, &Events::default());
                let provider = Arc::new(Provider::default());
                let mut extensions = module.extensions.lock().unwrap();
                match slot {
                    "actor_resolver" => extensions.actor_resolver = Some(provider),
                    "permission_checker" => extensions.permission_checker = Some(provider),
                    "permission_lookup" => extensions.permission_lookup = Some(provider),
                    _ => panic!("unexpected test case"),
                }
                drop(extensions);
                modules.push(module);
            }
            let registry = ModuleRegistry::new(modules, &BTreeMap::new()).unwrap();
            assert!(
                matches!(registry.freeze(vec![]), Err(RegistryError::DuplicateProvider { slot: actual, modules })
                if actual == slot && modules == ["a", "b", "c"][..count])
            );
        }
    }
}

#[test]
fn disabled_modules_contribute_no_runtime_implementations() {
    let mut disabled = module("a", &[], &Events::default());
    let provider = Arc::new(Provider::default());
    let module = Arc::get_mut(&mut disabled).unwrap();
    module.declaration.job_kinds = &["a.job"];
    let mut extensions = identity_extensions(&provider);
    extensions.job_handlers.push(provider.clone());
    extensions.job_completion_hooks.push(provider.clone());
    *module.extensions.get_mut().unwrap() = extensions;
    let settings = BTreeMap::from([("a".into(), false)]);
    let registry = ModuleRegistry::new(vec![disabled.clone()], &settings).unwrap();
    assert!(matches!(
        registry.freeze(vec![]),
        Err(RegistryError::MissingProvider {
            slot: "actor_resolver"
        })
    ));
    // 为可运行的冻结结果显式补上一个启用身份模块，禁用模块仍不贡献任何实现。
    let mut extensions = identity_extensions(&provider);
    extensions.job_handlers.push(provider.clone());
    extensions.job_completion_hooks.push(provider.clone());
    *disabled.extensions.lock().unwrap() = extensions;
    let registry = ModuleRegistry::new(vec![disabled, identity_module()], &settings).unwrap();
    let frozen = registry.freeze(vec![]).unwrap();
    assert!(frozen.job_handlers().is_empty());
    assert!(frozen.job_completion_hooks().is_empty());
    assert_eq!(provider.0.load(Ordering::SeqCst), 0);
}

#[test]
fn disabled_single_providers_do_not_conflict_with_enabled_providers() {
    let a = module("a", &[], &Events::default());
    let b = module("b", &[], &Events::default());
    let enabled = Arc::new(Provider::default());
    *a.extensions.lock().unwrap() = identity_extensions(&Arc::new(Provider::default()));
    *b.extensions.lock().unwrap() = identity_extensions(&enabled);
    let frozen = ModuleRegistry::new(vec![a, b], &BTreeMap::from([("a".into(), false)]))
        .unwrap()
        .freeze(vec![])
        .unwrap();
    let identity = frozen.identity();
    assert!(Arc::ptr_eq(
        &identity.actor_resolver,
        &(enabled.clone() as Arc<dyn ActorResolver>)
    ));
    assert!(Arc::ptr_eq(
        &identity.permission_checker,
        &(enabled.clone() as Arc<dyn PermissionChecker>)
    ));
    assert!(Arc::ptr_eq(
        &identity.permission_lookup,
        &(enabled.clone() as Arc<dyn PermissionLookup>)
    ));
}
