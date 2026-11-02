//! 注册顺序、所有权和失败补偿；解析替身只识别固定夹具，不模拟键码库。
use super::*;
use std::collections::{BTreeSet, VecDeque};

#[derive(Default)]
struct Fake(Mutex<(BTreeSet<u32>, Vec<String>, VecDeque<String>)>);
impl Fake {
    fn effect(&self, operation: &str, key: &ParsedShortcut) -> Result<(), AppError> {
        let mut state = self.0.lock().unwrap();
        let call = format!("{operation}:{}", key.id);
        state.1.push(call.clone());
        if state.2.front() == Some(&call) {
            state.2.pop_front();
            return Err(AppError::new(UNAVAILABLE));
        }
        if operation == "register" {
            assert!(state.0.insert(key.id));
        } else {
            assert!(state.0.remove(&key.id));
        }
        Ok(())
    }
}
impl ShortcutAdapter for Fake {
    fn parse(&self, binding: &str) -> Result<ParsedShortcut, AppError> {
        match binding {
            "Ctrl+Alt+D" => Ok(key(0)),
            "Ctrl+Alt+E" | "control + alt + KeyE" => Ok(key(1)),
            _ => Err(AppError::new(INVALID)),
        }
    }
    fn register(&self, key: &ParsedShortcut) -> Result<(), AppError> {
        self.effect("register", key)
    }
    fn unregister(&self, key: &ParsedShortcut) -> Result<(), AppError> {
        self.effect("unregister", key)
    }
}
fn key(id: u32) -> ParsedShortcut {
    ParsedShortcut {
        id,
        binding: if id == 0 { "Ctrl+Alt+D" } else { "Ctrl+Alt+E" }.into(),
    }
}
fn fixture() -> (Shortcuts, Arc<Fake>, Arc<ShortcutActivation>) {
    let adapter = Arc::new(Fake::default());
    let activation = Arc::new(ShortcutActivation::default());
    let service = Shortcuts::new(Some(adapter.clone()), activation.clone(), "Ctrl+Alt+D");
    adapter.0.lock().unwrap().1.clear();
    (service, adapter, activation)
}
fn change(
    service: &Shortcuts,
    new: Option<ParsedShortcut>,
    persist: impl FnOnce() -> Result<(), AppError>,
) -> Result<(), AppError> {
    service.apply(&mut service.operation.lock().unwrap(), new, persist)
}

#[test]
fn shortcut_registers_new_before_old_release() {
    let (service, adapter, activation) = fixture();
    change(&service, Some(key(1)), || {
        adapter.0.lock().unwrap().1.push("persist".into());
        assert!(!activation.pressed(0, true));
        assert!(!activation.pressed(1, true));
        Ok(())
    })
    .unwrap();
    assert_eq!(
        adapter.0.lock().unwrap().1,
        ["register:1", "unregister:0", "persist"]
    );
    assert!(activation.pressed(1, true));
    adapter.0.lock().unwrap().1.clear();
    change(
        &service,
        parse(adapter.as_ref(), " control + alt + KeyE ").unwrap(),
        || Ok(()),
    )
    .unwrap();
    assert!(adapter.0.lock().unwrap().1.is_empty());
}

#[test]
fn new_conflict_leaves_old_untouched() {
    let (service, adapter, activation) = fixture();
    adapter.0.lock().unwrap().2.push_back("register:1".into());
    assert_eq!(
        change(&service, Some(key(1)), || panic!("conflict cannot persist"))
            .unwrap_err()
            .code(),
        CONFLICT
    );
    assert_eq!(adapter.0.lock().unwrap().0, BTreeSet::from([0]));
    assert!(activation.pressed(0, true));
    assert!(matches!(
        service
            .settings(&Mutex::new(crate::native::test_config()), "t")
            .unwrap()
            .state,
        ShortcutStatus::Unavailable
    ));
}

#[test]
fn old_release_failure_revokes_new_or_reports_both() {
    for stuck in [false, true] {
        let (service, adapter, activation) = fixture();
        adapter.0.lock().unwrap().2.push_back("unregister:0".into());
        if stuck {
            adapter.0.lock().unwrap().2.push_back("unregister:1".into());
        }
        let error = change(&service, Some(key(1)), || {
            panic!("release failure cannot persist")
        })
        .unwrap_err();
        assert_eq!(
            error.code(),
            if stuck {
                super::super::COMPENSATION_FAILED
            } else {
                UNAVAILABLE
            }
        );
        assert!(activation.pressed(0, true));
        assert!(!activation.pressed(1, true));
        let snapshot = service
            .settings(&Mutex::new(crate::native::test_config()), "t")
            .unwrap();
        assert_eq!(snapshot.registered.len(), if stuck { 2 } else { 1 });
        assert_eq!(matches!(snapshot.state, ShortcutStatus::Degraded), stuck);
        change(&service, Some(key(1)), || Ok(())).unwrap();
        assert_eq!(adapter.0.lock().unwrap().0, BTreeSet::from([1]));
    }
}

#[test]
fn native_write_failure_compensates_shortcut_in_order() {
    for old_taken in [false, true] {
        for new_stuck in [false, true] {
            let (service, adapter, activation) = fixture();
            let error = change(&service, Some(key(1)), || {
                let mut state = adapter.0.lock().unwrap();
                state.1.push("persist".into());
                if old_taken {
                    state.2.push_back("register:0".into());
                }
                if new_stuck {
                    state.2.push_back("unregister:1".into());
                }
                Err(AppError::new(UNAVAILABLE))
            })
            .unwrap_err();
            assert_eq!(
                error.code(),
                if old_taken || new_stuck {
                    super::super::COMPENSATION_FAILED
                } else {
                    UNAVAILABLE
                }
            );
            assert_eq!(
                adapter.0.lock().unwrap().1,
                [
                    "register:1",
                    "unregister:0",
                    "persist",
                    "register:0",
                    "unregister:1"
                ]
            );
            assert_eq!(activation.pressed(0, true), !old_taken);
            assert!(!activation.pressed(1, true));
            assert_eq!(
                service
                    .settings(&Mutex::new(crate::native::test_config()), "t")
                    .unwrap()
                    .registered
                    .len(),
                usize::from(!old_taken) + usize::from(new_stuck)
            );
        }
    }
}

#[test]
fn clearing_restores_old_if_persist_fails() {
    let (service, adapter, _) = fixture();
    assert!(change(&service, None, || Err(AppError::new(UNAVAILABLE))).is_err());
    assert_eq!(adapter.0.lock().unwrap().1, ["unregister:0", "register:0"]);
    change(&service, None, || Ok(())).unwrap();
    assert!(adapter.0.lock().unwrap().0.is_empty());
}

#[test]
fn only_pressed_activates_and_exit_releases_exact_keys() {
    let (service, adapter, activation) = fixture();
    assert!(activation.pressed(0, true));
    assert!(!activation.pressed(0, true));
    assert!(!activation.pressed(0, false));
    assert!(activation.pressed(0, true));
    adapter.0.lock().unwrap().0.insert(1);
    service.shutdown().unwrap();
    service.shutdown().unwrap();
    assert_eq!(adapter.0.lock().unwrap().0, BTreeSet::from([1]));
    assert!(!activation.pressed(0, true));
    assert_eq!(
        change(&service, Some(key(0)), || panic!("closed"))
            .unwrap_err()
            .code(),
        LIFECYCLE_CLOSING
    );
}

#[test]
fn startup_conflict_is_visible_and_same_saved_value_can_retry() {
    let fake = Arc::new(Fake::default());
    fake.0.lock().unwrap().2.push_back("register:0".into());
    let service = Shortcuts::new(Some(fake), Arc::default(), "Ctrl+Alt+D");
    let config = Mutex::new(crate::native::test_config());
    assert!(matches!(
        service.settings(&config, "t").unwrap().state,
        ShortcutStatus::Unavailable
    ));
    change(&service, Some(key(0)), || Ok(())).unwrap();
    assert!(matches!(
        service.settings(&config, "t").unwrap().state,
        ShortcutStatus::Ready
    ));
}

#[test]
fn parser_and_overrides_have_no_system_effects() {
    let (service, adapter, _) = fixture();
    let root = tempfile::tempdir().unwrap();
    assert_eq!(
        service
            .update(
                &Mutex::new(crate::native::test_config()),
                root.path(),
                "invalid"
            )
            .unwrap_err()
            .code(),
        INVALID
    );
    for (environment, overrides) in [
        (
            vec![("TENON__SHORTCUTS__SHOW_MAIN".into(), "Ctrl+Alt+D".into())],
            vec![],
        ),
        (vec![], vec!["shortcuts.show_main=Ctrl+Alt+D".into()]),
    ] {
        let config = Mutex::new(crate::config::load(root.path(), environment, &overrides).unwrap());
        assert_eq!(
            service
                .update(&config, root.path(), "Ctrl+Alt+E")
                .unwrap_err()
                .code(),
            crate::config::SETTINGS_OVERRIDDEN
        );
    }
    assert!(adapter.0.lock().unwrap().1.is_empty());
}

#[test]
fn unsupported_shortcut_backend_never_writes_or_activates() {
    let root = tempfile::tempdir().unwrap();
    let activation = Arc::new(ShortcutActivation::default());
    let service = Shortcuts::new(None, activation.clone(), "Ctrl+Alt+D");
    let config = Mutex::new(crate::native::test_config());
    assert!(matches!(
        service.settings(&config, "t").unwrap().state,
        ShortcutStatus::Unsupported
    ));
    assert_eq!(
        service
            .update(&config, root.path(), "Ctrl+Alt+D")
            .unwrap_err()
            .code(),
        UNSUPPORTED
    );
    assert_eq!(std::fs::read_dir(root.path()).unwrap().count(), 0);
    assert!(!activation.pressed(0, true));
}
