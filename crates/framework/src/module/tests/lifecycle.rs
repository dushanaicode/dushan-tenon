use super::*;

#[tokio::test]
async fn stop_keeps_the_first_error_and_releases_every_started_module_once() {
    test_support::run(async |test| {
        let events = Events::default();
        let mut a = module("a", &[], &events);
        let mut b = module("b", &["a"], &events);
        Arc::get_mut(&mut a).unwrap().stop_error = Some(INTERNAL_UNEXPECTED);
        Arc::get_mut(&mut b).unwrap().stop_error = Some(INPUT_INVALID);
        provide_identity(&a);
        let mut registry = ModuleRegistry::new(vec![b, a], &BTreeMap::new()).unwrap();
        let frozen = registry.freeze(vec![]).unwrap();
        let services = Services::new(test).await;
        registry
            .start(services.context(&test.db, &frozen))
            .await
            .unwrap();
        assert_eq!(registry.stop().await.unwrap_err().code(), INPUT_INVALID);
        registry.stop().await.unwrap();
        assert_eq!(
            *events.lock().unwrap(),
            ["start:a", "start:b", "stop:b", "stop:a"]
        );
    })
    .await;
}

#[tokio::test]
async fn poisoned_lifecycle_stack_returns_errors_before_starting_modules() {
    test_support::run(async |test| {
        let events = Events::default();
        let a = module("a", &[], &events);
        provide_identity(&a);
        let mut registry = ModuleRegistry::new(vec![a], &BTreeMap::new()).unwrap();
        let frozen = registry.freeze(vec![]).unwrap();
        let services = Services::new(test).await;
        let poisoned = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            let _guard = registry.started.lock().unwrap();
            panic!("poison lifecycle stack");
        }));
        assert!(poisoned.is_err());
        assert_eq!(
            registry
                .start(services.context(&test.db, &frozen))
                .await
                .unwrap_err()
                .code(),
            INTERNAL_UNEXPECTED
        );
        assert_eq!(
            registry.stop().await.unwrap_err().code(),
            INTERNAL_UNEXPECTED
        );
        assert!(events.lock().unwrap().is_empty());
    })
    .await;
}

struct StartModule {
    inner: Arc<TestModule>,
    expected_extensions: Arc<AtomicUsize>,
    provider: Arc<Provider>,
    lookup: Mutex<Option<Arc<dyn PermissionLookup>>>,
}

impl Module for StartModule {
    fn declaration(&self) -> &ModuleDeclaration {
        self.inner.declaration()
    }

    fn extensions(self: Arc<Self>) -> ModuleExtensions {
        self.inner.clone().extensions()
    }

    fn start<'a>(&'a self, context: ModuleContext<'a>) -> ModuleFuture<'a> {
        assert_eq!(
            std::ptr::from_ref(context.extensions) as usize,
            self.expected_extensions.load(Ordering::SeqCst)
        );
        assert_eq!(self.provider.0.load(Ordering::SeqCst), 0);
        *self.lookup.lock().unwrap() =
            Some(context.extensions.identity().permission_lookup.clone());
        self.inner.start(context)
    }

    fn stop(&self) -> ModuleFuture<'_> {
        self.inner.stop()
    }
}

#[tokio::test(flavor = "current_thread")]
async fn starts_topologically_stops_in_reverse_and_skips_disabled_modules() {
    test_support::run(async |test| {
        let events = Events::default();
        let a = module("a", &[], &events);
        provide_identity(&a);
        let mut registry = ModuleRegistry::new(
            vec![
                module("c", &["b"], &events),
                a,
                module("b", &["a"], &events),
                module("off", &[], &events),
            ],
            &BTreeMap::from([("off".into(), false)]),
        )
        .unwrap();
        let extensions = registry.freeze(vec![]).unwrap();
        let services = Services::new(test).await;
        registry
            .start(services.context(&test.db, &extensions))
            .await
            .unwrap();
        registry.stop().await.unwrap();
        registry.stop().await.unwrap();
        assert_eq!(
            *events.lock().unwrap(),
            [
                "start:a", "start:b", "start:c", "stop:c", "stop:b", "stop:a"
            ]
        );
        assert_eq!(
            registry
                .list(&[])
                .iter()
                .map(|module| module.id.as_str())
                .collect::<Vec<_>>(),
            ["a", "b", "c", "off"]
        );
    })
    .await;
}

#[tokio::test(flavor = "current_thread")]
async fn startup_failure_recovers_started_modules_even_when_stop_fails() {
    test_support::run(async |test| {
        let events = Events::default();
        let mut b = module("b", &["a"], &events);
        Arc::get_mut(&mut b).unwrap().stop_error = Some(INTERNAL_UNEXPECTED);
        let mut c = module("c", &["b"], &events);
        Arc::get_mut(&mut c).unwrap().fail_start = true;
        let a = module("a", &[], &events);
        provide_identity(&a);
        let mut registry = ModuleRegistry::new(vec![c, b, a], &BTreeMap::new()).unwrap();
        let extensions = registry.freeze(vec![]).unwrap();
        let services = Services::new(test).await;
        let error = registry
            .start(services.context(&test.db, &extensions))
            .await
            .unwrap_err();
        assert_eq!(error.code(), INPUT_INVALID);
        registry.stop().await.unwrap();
        assert_eq!(
            *events.lock().unwrap(),
            ["start:a", "start:b", "start:c", "stop:b", "stop:a"]
        );
    })
    .await;
}

#[tokio::test]
async fn start_borrows_the_frozen_extensions_and_saves_handles_without_calling_later_modules() {
    test_support::run(async |test| {
        let events = Events::default();
        let provider = Arc::new(Provider::default());
        let expected_extensions = Arc::new(AtomicUsize::new(0));
        let a = Arc::new(StartModule {
            inner: module("a", &[], &events),
            expected_extensions: expected_extensions.clone(),
            provider: provider.clone(),
            lookup: Mutex::new(None),
        });
        let b = Arc::new(StartModule {
            inner: module("b", &["a"], &events),
            expected_extensions: expected_extensions.clone(),
            provider: provider.clone(),
            lookup: Mutex::new(None),
        });
        *b.inner.extensions.lock().unwrap() = identity_extensions(&provider);
        let mut registry =
            ModuleRegistry::new(vec![b.clone(), a.clone()], &BTreeMap::new()).unwrap();
        let extensions = registry.freeze(vec![]).unwrap();
        expected_extensions.store(std::ptr::from_ref(&extensions) as usize, Ordering::SeqCst);
        let services = Services::new(test).await;
        registry
            .start(services.context(&test.db, &extensions))
            .await
            .unwrap();
        assert_eq!(*events.lock().unwrap(), ["start:a", "start:b"]);
        assert_eq!(provider.0.load(Ordering::SeqCst), 0);
        let lookup = a.lookup.lock().unwrap().clone().unwrap();
        assert!(Arc::ptr_eq(
            &lookup,
            &(provider.clone() as Arc<dyn PermissionLookup>)
        ));
        assert!(
            !lookup
                .has_permission(Actor::User(Id::new()), "a.user.read")
                .await
                .unwrap()
        );
        assert_eq!(provider.0.load(Ordering::SeqCst), 1);
        assert_eq!(a.inner.extension_calls.load(Ordering::SeqCst), 1);
        assert_eq!(b.inner.extension_calls.load(Ordering::SeqCst), 1);
        registry.stop().await.unwrap();
    })
    .await;
}
