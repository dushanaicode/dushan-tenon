use super::*;
use std::sync::{Arc, Mutex};
use tenon_desktop::config::{AppSettingsUpdate, SETTINGS_OVERRIDDEN};

fn settings(root: &std::path::Path, overrides: &[String]) -> SettingsPorts {
    SettingsPorts {
        root: root.into(),
        config: Arc::new(Mutex::new(config::load(root, [], overrides).unwrap())),
    }
}

#[test]
fn auth_mode_commits_to_file_and_memory_and_respects_sources() {
    let root = crate::boot::tests::root();
    let settings = settings(root.path(), &[]);
    settings.set_mode(AuthMode::Login).unwrap();
    assert_eq!(AuthSettings::read(&settings).unwrap().mode, AuthMode::Login);
    assert_eq!(
        config::load(root.path(), [], &[]).unwrap().auth_mode(),
        config::AuthMode::Login
    );
    settings.set_mode(AuthMode::None).unwrap();
    assert_eq!(
        config::load(root.path(), [], &[]).unwrap().auth_mode(),
        config::AuthMode::None
    );
    let locked = super::tests::settings(root.path(), &["auth.mode=none".into()]);
    assert_eq!(
        locked.set_mode(AuthMode::Login).unwrap_err().code(),
        SETTINGS_OVERRIDDEN
    );
    assert_eq!(AuthSettings::read(&locked).unwrap().mode, AuthMode::None);
}

#[test]
fn auth_write_failure_does_not_commit_memory() {
    let root = crate::boot::tests::root();
    let settings = settings(root.path(), &[]);
    std::fs::create_dir(root.path().join("config.toml")).unwrap();
    assert!(settings.set_mode(AuthMode::Login).is_err());
    assert_eq!(AuthSettings::read(&settings).unwrap().mode, AuthMode::None);
}

#[test]
fn notification_gate_holds_read_lock_through_send_and_reads_live_switch() {
    let root = crate::boot::tests::root();
    let settings = settings(root.path(), &[]);
    let mut sends = 0;
    assert_eq!(
        settings
            .with_enabled(&mut || {
                assert!(settings.config.try_lock().is_err());
                sends += 1;
                Ok(DesktopDelivery::Delivered)
            })
            .unwrap(),
        DesktopDelivery::Delivered
    );
    assert_eq!(sends, 1);
    settings
        .config
        .lock()
        .unwrap()
        .update_settings(
            root.path(),
            &AppSettingsUpdate {
                desktop_notifications: Some(false),
                ..Default::default()
            },
        )
        .unwrap();
    assert_eq!(
        settings
            .with_enabled(&mut || panic!("disabled gate must not send"))
            .unwrap(),
        DesktopDelivery::Skipped
    );
}

#[test]
fn poisoned_configuration_is_an_error_for_both_ports() {
    let root = crate::boot::tests::root();
    let settings = settings(root.path(), &[]);
    let config = settings.config.clone();
    assert!(
        std::thread::spawn(move || {
            let _lock = config.lock().unwrap();
            panic!("poison test");
        })
        .join()
        .is_err()
    );
    assert_eq!(
        AuthSettings::read(&settings).unwrap_err().code(),
        INTERNAL_UNEXPECTED
    );
    assert_eq!(
        settings.set_mode(AuthMode::Login).unwrap_err().code(),
        INTERNAL_UNEXPECTED
    );
    assert_eq!(
        settings
            .with_enabled(&mut || panic!("poisoned gate must not send"))
            .unwrap_err()
            .code(),
        INTERNAL_UNEXPECTED
    );
}
