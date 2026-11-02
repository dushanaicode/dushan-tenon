use super::*;
use std::{
    fs,
    process::Command,
    sync::{
        Mutex,
        atomic::{AtomicUsize, Ordering},
    },
    time::Duration,
};
use tauri::test::{MockRuntime, mock_builder, mock_context, noop_assets};
use tenon_framework::{
    actor::Actor,
    error::INPUT_INVALID,
    secret::MemoryCredentials,
    stream::{StreamEvent, StreamOwner, StreamSink},
};

/// 日志 subscriber 是进程全局资源；每个装配用例在独立子进程恰好运行一次。
pub(crate) fn child(name: &str) -> bool {
    if std::env::var("TENON_H1_TEST_CHILD").as_deref() == Ok(name) {
        return true;
    }
    let output = Command::new(std::env::current_exe().unwrap())
        .args(["--exact", name, "--nocapture"])
        .env("TENON_H1_TEST_CHILD", name)
        .output()
        .unwrap();
    let stdout = String::from_utf8_lossy(&output.stdout);
    assert!(
        output.status.success(),
        "{stdout}\n{}",
        String::from_utf8_lossy(&output.stderr)
    );
    assert!(stdout.contains("1 passed; 0 failed"), "{stdout}");
    false
}

pub(crate) fn root() -> tempfile::TempDir {
    tempfile::tempdir_in(std::env::var_os("TEMP").expect("isolated TEMP")).unwrap()
}

pub(crate) fn app() -> tauri::App<MockRuntime> {
    let mut context = mock_context(noop_assets());
    context.config_mut().build.dev_url = Some("http://localhost:17430".parse().unwrap());
    mock_builder()
        .invoke_handler(crate::commands::handler())
        .build(context)
        .unwrap()
}

struct NoSystemNotifications;
impl DesktopNotifier for NoSystemNotifications {
    fn send(&self, _: &str, _: &str) -> Result<(), AppError> {
        panic!("test must not deliver an OS notification")
    }
    fn window_focused(&self) -> bool {
        true
    }
}

pub(crate) fn ports() -> Ports {
    let credentials = MemoryCredentials::default();
    Ports {
        notifier: Arc::new(NoSystemNotifications),
        secrets: Box::new(move |root| {
            Ok(SecretStore::with_backend(root, credentials.clone())?.boxed())
        }),
    }
}

pub(crate) struct Fixture {
    pub root: tempfile::TempDir,
    pub app: tauri::App<MockRuntime>,
    pub lifecycle: Arc<Lifecycle>,
    pub running: Running,
}

impl Fixture {
    pub async fn new() -> Self {
        let root = root();
        fs::write(
            root.path().join("config.toml"),
            "[ui]\ndeveloper_mode = true\n[notify]\ndesktop = false\n",
        )
        .unwrap();
        let app = app();
        let lifecycle = Arc::new(Lifecycle::new());
        let running = initialize(
            app.handle(),
            Options {
                state_root: Some(root.path().into()),
                ..Default::default()
            },
            &lifecycle,
            ports(),
        )
        .await
        .unwrap();
        lifecycle.install(running.shutdown.clone()).unwrap();
        Self {
            root,
            app,
            lifecycle,
            running,
        }
    }
}

fn closed_steps(root: &Path) -> Vec<String> {
    fs::read_dir(root.join("logs"))
        .unwrap()
        .flat_map(|entry| {
            fs::read_to_string(entry.unwrap().path())
                .unwrap()
                .lines()
                .map(|line| serde_json::from_str::<serde_json::Value>(line).unwrap())
                .collect::<Vec<_>>()
        })
        .filter(|event| event["fields"]["phase"] == "close")
        .filter_map(|event| event["fields"]["step"].as_str().map(str::to_owned))
        .collect()
}

#[tokio::test]
async fn restore_failure_precedes_startup_record_and_database() {
    let root = root();
    fs::write(root.path().join("restore-journal.json"), "broken journal").unwrap();
    let app = app();
    let lifecycle = Lifecycle::new();
    let result = initialize(
        app.handle(),
        Options {
            state_root: Some(root.path().into()),
            ..Default::default()
        },
        &lifecycle,
        ports(),
    )
    .await;
    assert!(result.is_err());
    assert!(!root.path().join("startup-state.json").exists());
    assert!(!root.path().join("data/app.db").exists());
    assert!(!root.path().join("logs").exists());
    assert!(app.webview_windows().is_empty());
    assert!(lifecycle.gate.is_closing());
    assert_eq!(
        fs::read_to_string(root.path().join("restore-journal.json")).unwrap(),
        "broken journal"
    );
}

#[tokio::test]
async fn services_failure_releases_logging_before_returning() {
    if !child("boot::tests::services_failure_releases_logging_before_returning") {
        return;
    }
    let root = root();
    let app = app();
    let lifecycle = Lifecycle::new();
    let result = initialize(
        app.handle(),
        Options {
            state_root: Some(root.path().into()),
            overrides: vec!["modules.unknown.enabled=true".into()],
            ..Default::default()
        },
        &lifecycle,
        ports(),
    )
    .await;
    assert!(result.is_err());
    assert!(!root.path().join("data/app.db").exists());
    // logging 的完成日志在守卫释放之后无法写入；日志文件可读证明已刷出此前步骤。
    let logs = fs::read_dir(root.path().join("logs")).unwrap().count();
    assert_eq!(logs, 1);
}

#[tokio::test]
async fn store_failure_rolls_back_database_and_preserves_original_error() {
    if !child("boot::tests::store_failure_rolls_back_database_and_preserves_original_error") {
        return;
    }
    let root = root();
    let app = app();
    let lifecycle = Lifecycle::new();
    let mut injected = ports();
    let calls = AtomicUsize::new(0);
    injected.secrets = Box::new(move |root| {
        if calls.fetch_add(1, Ordering::SeqCst) == 1 {
            return Err(AppError::new(INPUT_INVALID));
        }
        Ok(SecretStore::with_backend(root, MemoryCredentials::default())?.boxed())
    });
    let error = initialize(
        app.handle(),
        Options {
            state_root: Some(root.path().into()),
            ..Default::default()
        },
        &lifecycle,
        injected,
    )
    .await
    .err()
    .unwrap();
    assert_eq!(error.code(), INPUT_INVALID);
    assert_eq!(closed_steps(root.path()), ["database"]);
    let reopened = Db::open_sqlite(root.path().join("data/app.db"))
        .await
        .unwrap();
    assert!(
        !migrate::status(
            &reopened,
            &modules::DECLARATIONS
                .iter()
                .flat_map(|d| d.migrations.iter().copied())
                .chain(tenon_framework::migrations::MIGRATIONS.iter().copied())
                .collect::<Vec<_>>()
        )
        .await
        .unwrap()
        .applied
        .is_empty()
    );
    reopened.close().await;
}

#[tokio::test]
async fn executor_failure_stops_modules_and_database_in_reverse() {
    if !child("boot::tests::executor_failure_stops_modules_and_database_in_reverse") {
        return;
    }
    let root = root();
    let app = app();
    let lifecycle = Lifecycle::new();
    let mut stack = ShutdownStack::default();
    let ports = ports();
    let configured = configure(
        app.handle(),
        Options {
            state_root: Some(root.path().into()),
            ..Default::default()
        },
        &lifecycle,
        &mut stack,
    )
    .await
    .unwrap();
    let services = configure_services(configured, &ports).await.unwrap();
    let data = open_data(services, &ports, &mut stack).await.unwrap();
    let modules = start_modules(data, &mut stack).await.unwrap();
    let account = modules.services.account.clone();
    lifecycle.gate.close_admission();
    let error = start_runtime(modules, &lifecycle, &mut stack)
        .await
        .err()
        .unwrap();
    stack.rollback().await;
    assert_eq!(
        error.code(),
        tenon_framework::maintenance::LIFECYCLE_CLOSING
    );
    assert_eq!(closed_steps(root.path()), ["drain", "modules", "database"]);
    assert!(account.auth_status().await.is_err());
}

struct Sink(Mutex<Vec<StreamEvent<()>>>);
impl StreamSink<()> for Sink {
    fn send(&self, event: StreamEvent<()>) -> Result<(), AppError> {
        self.0.lock().unwrap().push(event);
        Ok(())
    }
}

#[tokio::test]
async fn concurrent_exit_waits_for_ipc_and_log_permits_before_stopping_modules() {
    if !child("boot::tests::concurrent_exit_waits_for_ipc_and_log_permits_before_stopping_modules")
    {
        return;
    }
    let fixture = Fixture::new().await;
    let state = &fixture.running.state;
    let actor = Actor::User(state.account.owner_id().unwrap());
    let stream = state
        .streams
        .open(
            StreamOwner {
                actor,
                scope: "main".into(),
            },
            Sink(Mutex::new(Vec::new())),
        )
        .unwrap();
    let permit = state.gate.enter().unwrap();
    let log_permit = permit.clone();
    let first = fixture
        .lifecycle
        .exit
        .request_exit(fixture.lifecycle.shutdown());
    let second = fixture
        .lifecycle
        .exit
        .request_exit(fixture.lifecycle.shutdown());
    tokio::pin!(first, second);
    assert!(
        tokio::time::timeout(Duration::from_millis(30), &mut first)
            .await
            .is_err()
    );
    assert!(
        tokio::time::timeout(Duration::from_millis(10), &mut second)
            .await
            .is_err()
    );
    assert!(stream.cancellation.is_cancelled());
    assert!(state.gate.enter().is_err());
    assert!(state.account.auth_status().await.is_ok());
    drop(permit);
    assert!(
        tokio::time::timeout(Duration::from_millis(10), &mut first)
            .await
            .is_err()
    );
    drop(log_permit);
    let (first, second) = tokio::time::timeout(Duration::from_secs(3), async {
        tokio::join!(first, second)
    })
    .await
    .unwrap();
    assert!(first && !second);
    assert!(state.account.auth_status().await.is_err());
    assert!(state.db.begin().await.is_err());
    assert_eq!(
        closed_steps(fixture.root.path()),
        ["ipc", "jobs", "drain", "modules", "database"]
    );
    assert_eq!(
        serde_json::from_str::<serde_json::Value>(
            &fs::read_to_string(fixture.root.path().join("startup-state.json")).unwrap()
        )
        .unwrap()["phase"],
        "clean"
    );
}

#[tokio::test]
async fn failure_before_first_window_uses_the_same_shutdown() {
    if !child("boot::tests::failure_before_first_window_uses_the_same_shutdown") {
        return;
    }
    let fixture = Fixture::new().await;
    let db = fixture.running.state.db.clone();
    fixture.app.manage(fixture.running.state);
    let error =
        crate::window::setup_window(fixture.app.handle(), fixture.lifecycle.clone()).unwrap_err();
    assert!(fixture.app.webview_windows().is_empty());
    crate::application::present_startup_failure(fixture.app.handle(), &fixture.lifecycle, &error);
    tokio::time::timeout(Duration::from_secs(3), async {
        while !fixture.lifecycle.exit.is_finished() {
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    assert_eq!(fixture.lifecycle.exit_code(), 1);
    assert!(db.begin().await.is_err());
    assert_eq!(
        closed_steps(fixture.root.path()),
        ["ipc", "jobs", "drain", "modules", "database"]
    );
    assert_eq!(
        serde_json::from_str::<serde_json::Value>(
            &fs::read_to_string(fixture.root.path().join("startup-state.json")).unwrap()
        )
        .unwrap()["phase"],
        "failed"
    );
}
