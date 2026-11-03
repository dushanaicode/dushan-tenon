use super::*;
use std::{
    fs,
    sync::atomic::{AtomicU64, Ordering},
};

static NEXT_ROOT: AtomicU64 = AtomicU64::new(0);

fn root() -> PathBuf {
    let temporary = PathBuf::from(std::env::var_os("TEMP").expect("explicit TEMP required"));
    assert!(temporary.is_absolute());
    let root = temporary.join(format!(
        "window-state-{}-{}",
        std::process::id(),
        NEXT_ROOT.fetch_add(1, Ordering::Relaxed)
    ));
    fs::create_dir(&root).unwrap();
    root
}

fn geometry() -> Geometry {
    Geometry {
        x: 100,
        y: 120,
        width: 1100.0,
        height: 720.0,
        scale_factor: 1.0,
        maximized: false,
        monitor: MonitorRect {
            x: 0,
            y: 0,
            width: 1920,
            height: 1080,
        },
    }
}

fn flags() -> StateFlags {
    StateFlags::SIZE | StateFlags::POSITION | StateFlags::MAXIMIZED
}

#[test]
fn hidden_gtk_restore_ignores_unmapped_origin_in_outer_size_cache() {
    let inner = (1100, 720);
    for cached_origin in [(0, 0), (30, 40), (1920, 1080), (u32::MAX, u32::MAX)] {
        assert_eq!(
            restoration_frame_dimensions(inner, cached_origin, true).unwrap(),
            (0, 0),
        );
    }
    assert_eq!(
        restoration_frame_dimensions(inner, (1116, 760), false).unwrap(),
        (16, 40),
    );
    assert!(matches!(
        restoration_frame_dimensions(inner, (0, 0), false),
        Err(Error::Unavailable),
    ));
    assert!(matches!(
        restoration_frame_dimensions(inner, (1116, 700), false),
        Err(Error::Unavailable),
    ));
}

#[test]
fn state_file_never_resolves_app_config() {
    assert!(WindowState::new("relative.json".into(), true).is_err());
    let root = root();
    let file = root.join("nested/state/window-state.json");
    let state = WindowState::new(file.clone(), true).unwrap();
    assert_eq!(state.status().state, RestoreState::FirstRun);
    assert!(!file.parent().unwrap().exists());
    state.record(geometry(), false, false, true, flags());
    state.flush().unwrap();
    assert_eq!(
        StateFile::new(file.clone()).unwrap().load().unwrap(),
        Some(geometry())
    );
    let document: serde_json::Value = serde_json::from_slice(&fs::read(&file).unwrap()).unwrap();
    assert_eq!(
        document.as_object().unwrap().keys().collect::<Vec<_>>(),
        ["main", "version"]
    );
    assert_eq!(document["version"], 1);
    for key in [
        "visible",
        "minimized",
        "fullscreen",
        "decorations",
        "alwaysOnTop",
        "route",
        "panels",
    ] {
        assert!(document["main"].get(key).is_none());
    }
    let other = WindowState::new(root.join("other/window-state.json"), true).unwrap();
    assert_eq!(other.status().state, RestoreState::FirstRun);
    let saved = fs::read(&file).unwrap();
    state.set_enabled(false);
    let mut moved = geometry();
    moved.x = 300;
    state.record(moved, false, false, true, flags());
    state.flush().unwrap();
    assert_eq!(fs::read(&file).unwrap(), saved);
}

#[test]
fn window_corrupt_is_visible_error() {
    let root = root();
    let path = root.join("window-state.json");
    for bytes in [
        b"{".to_vec(),
        br#"{"version":2,"main":{}}"#.to_vec(),
        vec![b' '; 65537],
    ] {
        fs::write(&path, &bytes).unwrap();
        let state = WindowState::new(path.clone(), true).unwrap();
        assert_eq!(state.status().state, RestoreState::Failed);
        assert_eq!(state.status().error, Some(Failure::Invalid));
        state.record(geometry(), false, false, true, flags());
        state.flush().unwrap();
        assert_eq!(fs::read(&path).unwrap(), bytes);
        let disabled = WindowState::new(path.clone(), false).unwrap();
        assert_eq!(disabled.status().state, RestoreState::Disabled);
        assert_eq!(disabled.status().error, None);
        state.reset(geometry()).unwrap();
        assert_eq!(state.status().state, RestoreState::Restored);
    }
    let directory = root.join("directory.json");
    fs::create_dir(&directory).unwrap();
    let failed_read = WindowState::new(directory, true).unwrap();
    assert_eq!(failed_read.status().error, Some(Failure::Read));
    let file = StateFile::new(path.clone()).unwrap();
    let saved = fs::read(&path).unwrap();
    // The directory path for scratch is an ordinary file: deterministic write denial on Windows too.
    let blocked = root.join("write-denied");
    fs::create_dir(&blocked).unwrap();
    fs::write(blocked.join("Temp"), "keep").unwrap();
    fs::write(blocked.join("window-state.json"), &saved).unwrap();
    let state = WindowState::new(blocked.join("window-state.json"), true).unwrap();
    let mut moved = geometry();
    moved.x = 400;
    assert!(state.reset(moved).is_err());
    assert_eq!(state.status().error, Some(Failure::Write));
    assert_eq!(fs::read(blocked.join("window-state.json")).unwrap(), saved);
    let mut document: serde_json::Value = serde_json::from_slice(&saved).unwrap();
    document["version"] = serde_json::json!(2);
    fs::write(&path, serde_json::to_vec(&document).unwrap()).unwrap();
    assert!(matches!(file.load(), Err(Error::Invalid)));
    let unknown_version = fs::read(&path).unwrap();
    let state = WindowState::new(path.clone(), true).unwrap();
    state.record(geometry(), false, false, true, flags());
    state.shutdown().unwrap();
    assert_eq!(fs::read(&path).unwrap(), unknown_version);
    document["version"] = serde_json::json!(1);
    for extra in [
        serde_json::json!({"second": {}}),
        serde_json::json!({"visible": true}),
    ] {
        document
            .as_object_mut()
            .unwrap()
            .extend(extra.as_object().unwrap().clone());
        fs::write(&path, serde_json::to_vec(&document).unwrap()).unwrap();
        assert!(file.load().is_err());
    }
    for value in [0.0, -1.0, f64::INFINITY, f64::NAN] {
        let mut invalid = geometry();
        invalid.scale_factor = value;
        assert!(file.save(&invalid).is_err());
    }
}

#[test]
fn geometry_preserves_normal_rect() {
    let root = root();
    let state = WindowState::new(root.join("window-state.json"), true).unwrap();
    let mut no_normal_rect = geometry();
    no_normal_rect.maximized = true;
    state.record(no_normal_rect, false, false, false, flags());
    assert_eq!(state.geometry(), None);
    state.reset(geometry()).unwrap();
    let mut maximized = geometry();
    maximized.x = 0;
    maximized.y = 0;
    maximized.width = 1920.0;
    maximized.height = 1080.0;
    maximized.maximized = true;
    state.record(maximized.clone(), false, false, true, flags());
    let mut expected = geometry();
    expected.maximized = true;
    assert_eq!(state.geometry(), Some(expected.clone()));
    maximized.maximized = false;
    state.record(maximized.clone(), true, false, true, flags());
    assert_eq!(state.geometry(), Some(expected));
    state.record(maximized, false, false, false, flags());
    assert_eq!(state.geometry(), Some(geometry()));
    let display = Display {
        rect: MonitorRect {
            x: 0,
            y: 0,
            width: 2560,
            height: 1440,
        },
        work_area: MonitorRect {
            x: 0,
            y: 0,
            width: 2560,
            height: 1400,
        },
        scale: 1.5,
    };
    let (restored, adjusted) = restore_geometry(
        &geometry(),
        std::slice::from_ref(&display),
        &display,
        (16, 40),
        (720.0, 540.0),
    );
    assert_eq!((restored.x, restored.y), (150, 180));
    assert_eq!((restored.width, restored.height), (1100.0, 720.0));
    assert!(!adjusted);
    let mut gone = geometry();
    gone.monitor.x = -1920;
    gone.x = -1800;
    let (restored, adjusted) = restore_geometry(
        &gone,
        std::slice::from_ref(&display),
        &display,
        (16, 40),
        (720.0, 540.0),
    );
    assert!(adjusted);
    assert!(restored.x >= 0 && restored.y >= 0);
    assert_eq!(state.geometry(), Some(geometry()));
    state.flush().unwrap();
}

#[test]
fn debounce_disable_and_explicit_exit_flush() {
    let root = root();
    let path = root.join("window-state.json");
    let state = WindowState::new(path.clone(), true).unwrap();
    state.record(geometry(), false, false, true, flags());
    assert!(!path.exists());
    state.set_enabled(false);
    std::thread::sleep(Duration::from_millis(600));
    assert!(!path.exists());
    state.set_enabled(true);
    let mut moved = geometry();
    moved.x = 401;
    state.record(moved.clone(), false, false, true, flags());
    state.flush().unwrap();
    assert_eq!(
        StateFile::new(path.clone()).unwrap().load().unwrap(),
        Some(moved)
    );
    let mut moved = geometry();
    moved.x = 500;
    state.record(moved.clone(), false, false, true, flags());
    std::thread::sleep(Duration::from_millis(1100));
    assert_eq!(StateFile::new(path).unwrap().load().unwrap(), Some(moved));
    state.shutdown().unwrap();
    state.set_enabled(true);
    assert_eq!(state.status().state, RestoreState::Disabled);
}
