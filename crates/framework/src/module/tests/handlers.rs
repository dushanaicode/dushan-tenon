use super::*;

struct HostJob {
    kind: &'static str,
    permissions: &'static [&'static str],
    attempts: i32,
    concurrency: usize,
    runs: AtomicUsize,
}

impl HostJob {
    fn new(kind: &'static str) -> Self {
        Self {
            kind,
            permissions: &[],
            attempts: 1,
            concurrency: 1,
            runs: AtomicUsize::new(0),
        }
    }
}

impl JobHandler for HostJob {
    fn kind(&self) -> &'static str {
        self.kind
    }
    fn permissions(&self) -> &'static [&'static str] {
        self.permissions
    }
    fn retry_safe(&self) -> bool {
        true
    }
    fn max_attempts(&self) -> i32 {
        self.attempts
    }
    fn concurrency(&self) -> usize {
        self.concurrency
    }
    fn run(&self, _: JobContext) -> JobFuture<'_> {
        self.runs.fetch_add(1, Ordering::SeqCst);
        Box::pin(async { Ok(serde_json::json!({"host": true})) })
    }
}

#[test]
fn module_and_host_handlers_are_merged_once_in_topology_order() {
    let mut a = module("a", &[], &Events::default());
    let mut b = module("b", &["a"], &Events::default());
    Arc::get_mut(&mut a).unwrap().declaration.job_kinds = &["a.local", "a.host"];
    Arc::get_mut(&mut b).unwrap().declaration.job_kinds = &["b.host"];
    a.extensions.lock().unwrap().job_handlers = vec![Arc::new(TestJob("a.local", &[]))];
    provide_identity(&a);
    let registry = ModuleRegistry::new(vec![b.clone(), a.clone()], &BTreeMap::new()).unwrap();
    assert_eq!(registry.job_kinds(), ["a.local", "a.host", "b.host"]);
    assert!(matches!(
        registry.freeze(vec![]),
        Err(RegistryError::InvalidJob { .. })
    ));
    let a_host = Arc::new(HostJob::new("a.host"));
    let b_host = Arc::new(HostJob::new("b.host"));
    for _ in 0..2 {
        let frozen = registry
            .freeze(vec![b_host.clone(), a_host.clone()])
            .unwrap();
        assert_eq!(
            frozen
                .job_handlers()
                .iter()
                .map(|h| h.kind())
                .collect::<Vec<_>>(),
            ["a.local", "a.host", "b.host"]
        );
        assert!(Arc::ptr_eq(
            &frozen.job_handlers()[1],
            &(a_host.clone() as Arc<dyn JobHandler>)
        ));
        assert_eq!(a.extension_calls.load(Ordering::SeqCst), 1);
        assert_eq!(b.extension_calls.load(Ordering::SeqCst), 1);
        assert_eq!(a_host.runs.load(Ordering::SeqCst), 0);
        assert_eq!(b_host.runs.load(Ordering::SeqCst), 0);
    }
}

#[test]
fn merged_handlers_reject_duplicates_missing_unknown_permissions_and_invalid_limits() {
    for enabled in [true, false] {
        for case in [
            "missing",
            "duplicate",
            "host_duplicate",
            "unknown_kind",
            "unknown_module",
            "invalid_kind",
            "permission",
            "zero_attempts",
            "negative_attempts",
            "concurrency",
        ] {
            let mut a = module("a", &[], &Events::default());
            Arc::get_mut(&mut a).unwrap().declaration.job_kinds = &["a.job"];
            if case == "duplicate" {
                a.extensions
                    .lock()
                    .unwrap()
                    .job_handlers
                    .push(Arc::new(TestJob("a.job", &[])));
            }
            let registry = ModuleRegistry::new(
                vec![a, identity_module()],
                &BTreeMap::from([("a".into(), enabled)]),
            )
            .unwrap();
            let mut host = HostJob::new("a.job");
            match case {
                "unknown_kind" => host.kind = "a.other",
                "unknown_module" => host.kind = "missing.job",
                "invalid_kind" => host.kind = "malformed",
                "permission" => host.permissions = &["a.job.undeclared"],
                "zero_attempts" => host.attempts = 0,
                "negative_attempts" => host.attempts = -1,
                "concurrency" => host.concurrency = 0,
                _ => {}
            }
            let mut handlers: Vec<Arc<dyn JobHandler>> = vec![Arc::new(host)];
            if case == "missing" {
                handlers.clear();
            }
            if case == "host_duplicate" {
                handlers.push(Arc::new(HostJob::new("a.job")));
            }
            assert!(
                matches!(
                    registry.freeze(handlers),
                    Err(RegistryError::InvalidJob { .. })
                ),
                "{case}, enabled={enabled}"
            );
        }
    }
}

#[test]
fn disabled_host_handlers_are_validated_but_never_bound() {
    let mut disabled = module("off", &[], &Events::default());
    Arc::get_mut(&mut disabled).unwrap().declaration.job_kinds = &["off.host"];
    let host = Arc::new(HostJob::new("off.host"));
    let registry = ModuleRegistry::new(
        vec![disabled, identity_module()],
        &BTreeMap::from([("off".into(), false)]),
    )
    .unwrap();
    assert!(
        matches!(registry.freeze(vec![]), Err(RegistryError::InvalidJob { module, kind }) if module == "off" && kind == "off.host")
    );
    let frozen = registry.freeze(vec![host.clone()]).unwrap();
    assert!(frozen.job_handlers().is_empty());
    assert_eq!(host.runs.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn frozen_host_handlers_run_in_the_real_job_queue() {
    test_support::run(async |test| {
        use crate::{
            instance::InstanceId,
            job::{JobRunner, JobStatus, JobsConfig, SubmitJob},
            maintenance::OperationGate,
        };
        let mut a = module("a", &[], &Events::default());
        Arc::get_mut(&mut a).unwrap().declaration.job_kinds = &["a.host"];
        provide_identity(&a);
        let mut registry = ModuleRegistry::new(vec![a], &BTreeMap::new()).unwrap();
        let host = Arc::new(HostJob::new("a.host"));
        let frozen = registry.freeze(vec![host.clone()]).unwrap();
        test.upgrade(&registry.migrations(), 1).await.unwrap();
        let services = Services::new(test).await;
        registry
            .start(services.context(&test.db, &frozen))
            .await
            .unwrap();
        let queue = JobQueue::new(
            test.db.clone(),
            frozen.job_handlers().to_vec(),
            registry.schedules(),
            frozen.job_completion_hooks().to_vec(),
            InstanceId::load_or_create(test.root.path()).unwrap(),
        )
        .unwrap();
        assert_eq!(host.runs.load(Ordering::SeqCst), 0);
        let id = queue
            .submit(
                &test.db,
                SubmitJob {
                    kind: "a.host".into(),
                    payload: serde_json::json!({}),
                    priority: 0,
                    run_after: None,
                    submitted_by: None,
                },
            )
            .await
            .unwrap();
        let runner = JobRunner::start(
            queue.clone(),
            frozen.identity().permission_lookup.clone(),
            JobsConfig::new(1, 10).unwrap(),
            OperationGate::default(),
        )
        .await
        .unwrap();
        let result = tokio::time::timeout(std::time::Duration::from_secs(5), async {
            loop {
                let job = queue.get(id).await.unwrap();
                if job.status == JobStatus::Succeeded {
                    break job;
                }
                tokio::time::sleep(std::time::Duration::from_millis(10)).await;
            }
        })
        .await
        .unwrap();
        assert_eq!(result.result, Some(serde_json::json!({"host": true})));
        assert_eq!(host.runs.load(Ordering::SeqCst), 1);
        runner.stop().await.unwrap();
        registry.stop().await.unwrap();
    })
    .await;
}

#[test]
fn schedule_declarations_require_valid_unique_keys_and_owned_kinds() {
    let events = Events::default();
    for (key, kind, duplicate) in [
        ("", "a.job", false),
        ("a", "a.job", false),
        ("a.", "a.job", false),
        ("b.daily", "a.job", false),
        ("a.UPPER", "a.job", false),
        ("a.bad-name", "a.job", false),
        ("a.two.parts", "a.job", false),
        ("a.daily", "b.job", false),
        ("a.daily", "a.missing", false),
        ("a.daily", "a.job", true),
    ] {
        let mut a = module("a", &[], &events);
        let declaration = ScheduleDeclaration {
            key,
            kind,
            cron: "0 3 * * *",
            enabled: true,
            payload: "{}",
        };
        let a_mut = Arc::get_mut(&mut a).unwrap();
        a_mut.declaration.job_kinds = &["a.job"];
        a_mut.extensions.get_mut().unwrap().job_handlers = vec![Arc::new(TestJob("a.job", &[]))];
        a_mut.declaration.schedules = Box::leak(
            if duplicate {
                vec![declaration, declaration]
            } else {
                vec![declaration]
            }
            .into_boxed_slice(),
        );
        assert!(
            matches!(
                ModuleRegistry::new(vec![a], &BTreeMap::new()),
                Err(RegistryError::InvalidSchedule { .. })
            ),
            "{key} / {kind}"
        );
    }
    let mut a = module("a", &[], &events);
    let a_mut = Arc::get_mut(&mut a).unwrap();
    a_mut.declaration.job_kinds = &["a.job"];
    a_mut.extensions.get_mut().unwrap().job_handlers = vec![Arc::new(TestJob("a.job", &[]))];
    a_mut.declaration.schedules = &[ScheduleDeclaration {
        key: "a.daily",
        kind: "a.job",
        cron: "0 3 * * *",
        enabled: true,
        payload: "{}",
    }];
    let registry = ModuleRegistry::new(
        vec![a, identity_module()],
        &BTreeMap::from([("a".into(), false)]),
    )
    .unwrap();
    assert_eq!(registry.schedules()[0].key, "a.daily");
    assert!(registry.freeze(vec![]).unwrap().job_handlers().is_empty());
}

#[test]
fn job_declarations_require_valid_unique_matching_handlers() {
    let events = Events::default();
    for kind in [
        "",
        "a",
        "other.job",
        "a.UPPER",
        "a.two.parts",
        "a.bad-name",
        "a.",
    ] {
        let mut a = module("a", &[], &events);
        Arc::get_mut(&mut a).unwrap().declaration.job_kinds =
            Box::leak(vec![kind].into_boxed_slice());
        assert!(matches!(
            ModuleRegistry::new(vec![a], &BTreeMap::new()),
            Err(RegistryError::InvalidJob { .. })
        ));
    }
    for handlers in [vec![], vec!["a.other"], vec!["a.job", "a.job"]] {
        let mut a = module("a", &[], &events);
        let a_mut = Arc::get_mut(&mut a).unwrap();
        a_mut.declaration.job_kinds = &["a.job"];
        a_mut.extensions.get_mut().unwrap().job_handlers = handlers
            .into_iter()
            .map(|kind| Arc::new(TestJob(kind, &[])) as Arc<dyn JobHandler>)
            .collect();
        assert!(matches!(
            ModuleRegistry::new(vec![a], &BTreeMap::new())
                .unwrap()
                .freeze(vec![]),
            Err(RegistryError::InvalidJob { .. })
        ));
    }
    let mut a = module("a", &[], &events);
    let a_mut = Arc::get_mut(&mut a).unwrap();
    a_mut.declaration.job_kinds = &["a.job"];
    a_mut.extensions.get_mut().unwrap().job_handlers = vec![Arc::new(TestJob("a.job", &[]))];
    let registry = ModuleRegistry::new(
        vec![a, identity_module()],
        &BTreeMap::from([("a".into(), false)]),
    )
    .unwrap();
    assert_eq!(registry.job_kinds(), vec!["a.job"]);
    assert!(registry.freeze(vec![]).unwrap().job_handlers().is_empty());
}

#[test]
fn every_job_permission_must_be_declared() {
    for (keys, valid) in [
        (&["a.job.read", "a.job.write"][..], true),
        (&["a.job.missing", "a.job.write"][..], false),
        (&["a.job.read", "a.job.missing"][..], false),
    ] {
        let mut a = module("a", &[], &Events::default());
        let a_mut = Arc::get_mut(&mut a).unwrap();
        a_mut.declaration.permissions = &["a.job.read", "a.job.write"];
        a_mut.declaration.job_kinds = &["a.job"];
        a_mut.extensions.get_mut().unwrap().job_handlers = vec![Arc::new(TestJob("a.job", keys))];
        let result = ModuleRegistry::new(vec![a, identity_module()], &BTreeMap::new())
            .unwrap()
            .freeze(vec![]);
        if valid {
            assert!(result.is_ok());
        } else {
            assert!(matches!(result, Err(RegistryError::InvalidJob { .. })));
        }
    }
}

#[test]
fn handlers_and_hooks_preserve_dependency_and_module_order() {
    let mut a = module("a", &[], &Events::default());
    let mut b = module("b", &["a"], &Events::default());
    let hooks: Vec<Arc<dyn JobCompletionHook>> = (0..4)
        .map(|_| Arc::new(Provider::default()) as Arc<dyn JobCompletionHook>)
        .collect();
    for (module, kinds, hooks) in [
        (&mut a, &["a.second", "a.first"][..], &hooks[..2]),
        (&mut b, &["b.second", "b.first"][..], &hooks[2..]),
    ] {
        let module = Arc::get_mut(module).unwrap();
        module.declaration.job_kinds = kinds;
        let extensions = module.extensions.get_mut().unwrap();
        extensions.job_handlers = kinds
            .iter()
            .map(|kind| Arc::new(TestJob(kind, &[])) as Arc<dyn JobHandler>)
            .collect();
        extensions.job_completion_hooks = hooks.to_vec();
    }
    provide_identity(&a);
    let frozen = ModuleRegistry::new(vec![b, a], &BTreeMap::new())
        .unwrap()
        .freeze(vec![])
        .unwrap();
    assert_eq!(
        frozen
            .job_handlers()
            .iter()
            .map(|handler| handler.kind())
            .collect::<Vec<_>>(),
        ["a.second", "a.first", "b.second", "b.first"]
    );
    assert_eq!(frozen.job_completion_hooks().len(), hooks.len());
    for (actual, expected) in frozen.job_completion_hooks().iter().zip(&hooks) {
        assert!(Arc::ptr_eq(actual, expected));
    }
}

#[test]
fn no_handlers_or_hooks_is_valid() {
    let frozen = ModuleRegistry::new(vec![identity_module()], &BTreeMap::new())
        .unwrap()
        .freeze(vec![])
        .unwrap();
    assert!(frozen.job_handlers().is_empty());
    assert!(frozen.job_completion_hooks().is_empty());
}
