use super::{invoke, with_host, with_host_ports};
use crate::boot;
use serde_json::json;
use std::sync::{
    Arc,
    atomic::{AtomicUsize, Ordering},
};
use tenon_framework::error::AppError;
use tenon_module_notify::DesktopNotifier;

#[derive(Default)]
struct Notifications(AtomicUsize);
impl DesktopNotifier for Notifications {
    fn send(&self, _: &str, _: &str) -> Result<(), AppError> {
        self.0.fetch_add(1, Ordering::SeqCst);
        Ok(())
    }
    fn window_focused(&self) -> bool {
        false
    }
}

#[test]
fn notifications_use_active_identity_and_live_desktop_policy() {
    let notifier = Arc::new(Notifications::default());
    let mut ports = boot::tests::ports();
    ports.notifier = notifier.clone();
    with_host_ports(
        "ipc_tests::notify::notifications_use_active_identity_and_live_desktop_policy",
        "[notify]\ndesktop=true\n",
        ports,
        |_| {},
        |window, _| {
            assert_eq!(
                invoke(window, "notify_test_send", json!({})).unwrap(),
                json!({"desktop":"sent"})
            );
            assert_eq!(notifier.0.load(Ordering::SeqCst), 1);
            invoke(
                window,
                "app_settings_update",
                json!({"input":{"desktopNotifications":false}}),
            )
            .unwrap();
            assert_eq!(
                invoke(window, "notify_test_send", json!({})).unwrap(),
                json!({"desktop":"disabled"})
            );
            assert_eq!(notifier.0.load(Ordering::SeqCst), 1);
            let page = invoke(
                window,
                "notify_list",
                json!({"input":{"page":1,"pageSize":5,"unreadOnly":true}}),
            )
            .unwrap();
            assert_eq!(page["total"], 2);
            for item in page["items"].as_array().unwrap() {
                assert_eq!(item["category"], "test");
                assert_eq!(item["titleKey"], "notify.test.title");
                assert!(item["jobId"].is_null() && item["readAt"].is_null());
            }
            invoke(
                window,
                "notify_mark_read",
                json!({"input":{"ids":[page["items"][0]["id"]]}}),
            )
            .unwrap();
            assert_eq!(invoke(window, "notify_unread_count", json!({})).unwrap(), 1);
            invoke(window, "notify_mark_all_read", json!({})).unwrap();
            assert_eq!(invoke(window, "notify_unread_count", json!({})).unwrap(), 0);
            invoke(
                window,
                "account_auth_enable_login",
                json!({"input":{"password":"notification-password"}}),
            )
            .unwrap();
            invoke(window, "account_session_lock", json!({})).unwrap();
            assert_eq!(
                invoke(window, "notify_test_send", json!({})).unwrap_err()["code"],
                "account.session.locked"
            );
            invoke(window, "account_auth_logout", json!({})).unwrap();
            assert_eq!(
                invoke(window, "notify_test_send", json!({})).unwrap_err()["code"],
                "account.auth.required"
            );
            assert_eq!(notifier.0.load(Ordering::SeqCst), 1);
        },
    );
}

#[test]
fn disabled_notifications_are_rejected_before_identity() {
    with_host(
        "ipc_tests::notify::disabled_notifications_are_rejected_before_identity",
        "[auth]\nmode='login'\n[modules.notify]\nenabled=false\n",
        |_| {},
        |window, _| {
            for (command, body) in [
                ("notify_test_send", json!({})),
                ("notify_unread_count", json!({})),
                ("notify_mark_all_read", json!({})),
                (
                    "notify_list",
                    json!({"input":{"page":1,"pageSize":5,"unreadOnly":true}}),
                ),
                (
                    "notify_mark_read",
                    json!({"input":{"ids":[tenon_framework::id::Id::new()]}}),
                ),
            ] {
                assert_eq!(
                    invoke(window, command, body).unwrap_err()["code"],
                    "app.module.disabled",
                    "{command}"
                );
            }
        },
    );
}
