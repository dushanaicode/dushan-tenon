//! 启动时确定安装与显式根范围；范围不支持时不构造或探测系统注册项。

use std::path::Path;
#[cfg(target_os = "linux")]
use tauri::Manager;
use tenon_desktop::native::autostart::{Autostart, AutostartAdapter, AutostartScope};
use tenon_framework::error::AppError;

pub(super) fn create(
    app: &tauri::AppHandle,
    root: &Path,
    explicit_root: bool,
) -> Result<Autostart, AppError> {
    use std::sync::Arc;
    use tenon_desktop::native::UNAVAILABLE;
    let executable = std::env::current_exe().map_err(|_| AppError::new(UNAVAILABLE))?;
    #[cfg(target_os = "linux")]
    let executable = app
        .env()
        .appimage
        .clone()
        .map(std::path::PathBuf::from)
        .unwrap_or(executable);
    #[cfg(any(windows, target_os = "linux"))]
    let installed = installed_marker(&executable);
    #[cfg(target_os = "macos")]
    let installed = installed_mac_bundle(&executable);
    #[cfg(any(windows, target_os = "macos", target_os = "linux"))]
    let scope = AutostartScope::classify(tauri::is_dev(), explicit_root, installed);
    #[cfg(not(any(windows, target_os = "macos", target_os = "linux")))]
    let scope = AutostartScope::Unsupported(
        tenon_desktop::native::autostart::AutostartUnsupportedReason::UnsupportedPlatform,
    );
    let adapter: Option<Arc<dyn AutostartAdapter>> = if scope == AutostartScope::Product {
        #[cfg(windows)]
        {
            let _ = root;
            Some(Arc::new(super::autostart_registry::SystemAutostart::new(
                &app.package_info().name,
                &executable,
                &[],
            )?))
        }
        #[cfg(target_os = "macos")]
        {
            let _ = (app, root);
            Some(Arc::new(super::autostart_macos::SystemMacAutostart))
        }
        #[cfg(target_os = "linux")]
        {
            let desktop = match std::env::var("XDG_CURRENT_DESKTOP") {
                Ok(value) => value,
                Err(std::env::VarError::NotPresent) => String::new(),
                Err(std::env::VarError::NotUnicode(_)) => return Err(AppError::new(UNAVAILABLE)),
            };
            Some(Arc::new(super::autostart_linux::SystemXdgAutostart::new(
                &app.path()
                    .config_dir()
                    .map_err(|_| AppError::new(UNAVAILABLE))?,
                root.join("Temp/autostart"),
                &app.config().identifier,
                &app.package_info().name,
                &executable,
                &desktop,
            )?))
        }
        #[cfg(not(any(windows, target_os = "macos", target_os = "linux")))]
        {
            None
        }
    } else {
        None
    };
    Autostart::new(scope, adapter)
}

#[cfg(any(windows, target_os = "linux", test))]
fn installed_marker(executable: &Path) -> bool {
    use std::io::Read;
    let path = executable.with_file_name("tenon-installed.marker");
    if !std::fs::symlink_metadata(&path).is_ok_and(|metadata| metadata.is_file()) {
        return false;
    }
    let Ok(mut file) = std::fs::File::open(path) else {
        return false;
    };
    file.metadata().is_ok_and(|metadata| metadata.is_file()) && file.read(&mut [0]).is_ok()
}

#[cfg(any(target_os = "macos", test))]
fn installed_mac_bundle(executable: &Path) -> bool {
    let Some(macos) = executable.parent() else {
        return false;
    };
    let Some(contents) = macos.parent() else {
        return false;
    };
    let Some(bundle) = contents.parent() else {
        return false;
    };
    macos.file_name() == Some("MacOS".as_ref())
        && contents.file_name() == Some("Contents".as_ref())
        && bundle.extension() == Some("app".as_ref())
        && executable.is_file()
        && contents.join("Info.plist").is_file()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mac_install_scope_requires_actual_application_bundle() {
        let root = tempfile::tempdir().unwrap();
        let executable = root.path().join("Example.app/Contents/MacOS/example");
        std::fs::create_dir_all(executable.parent().unwrap()).unwrap();
        std::fs::write(&executable, "fixture").unwrap();
        assert!(!installed_mac_bundle(&executable));
        std::fs::write(
            root.path().join("Example.app/Contents/Info.plist"),
            "fixture",
        )
        .unwrap();
        assert!(installed_mac_bundle(&executable));
        let raw = root.path().join("example");
        std::fs::write(&raw, "fixture").unwrap();
        assert!(!installed_mac_bundle(&raw));
    }

    #[test]
    fn install_marker_requires_readable_regular_file() {
        let root = tempfile::tempdir().unwrap();
        let exe = root.path().join("app.exe");
        let marker = root.path().join("tenon-installed.marker");
        assert!(!installed_marker(&exe));
        std::fs::create_dir(&marker).unwrap();
        assert!(!installed_marker(&exe));
        std::fs::remove_dir(&marker).unwrap();
        std::fs::write(&marker, "installed\n").unwrap();
        assert!(installed_marker(&exe));
    }
}
