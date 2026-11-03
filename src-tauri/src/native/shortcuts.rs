//! 插件解析、平台保留键和注册 API；事务及按下去重由 desktop 管理。

use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut};
use tenon_desktop::native::{
    UNAVAILABLE,
    shortcuts::{CONFLICT, INVALID, ParsedShortcut, ShortcutAdapter},
};
use tenon_framework::error::AppError;

/// 插件 Linux 后端只支持 X11，Wayland 明确呈现 unsupported。
pub(super) fn system_supported() -> bool {
    !cfg!(target_os = "linux")
        || (std::env::var("XDG_SESSION_TYPE").as_deref() != Ok("wayland")
            && std::env::var_os("WAYLAND_DISPLAY").is_none())
}

pub(super) struct SystemShortcuts(pub tauri::AppHandle);

impl ShortcutAdapter for SystemShortcuts {
    fn parse(&self, binding: &str) -> Result<ParsedShortcut, AppError> {
        let shortcut = parse_for(binding, cfg!(target_os = "macos"))?;
        Ok(ParsedShortcut {
            id: shortcut.id(),
            binding: shortcut.into_string(),
        })
    }

    fn register(&self, key: &ParsedShortcut) -> Result<(), AppError> {
        let shortcut: Shortcut = key.binding.parse().map_err(|_| AppError::new(INVALID))?;
        self.0
            .global_shortcut()
            .register(shortcut)
            .map_err(|_| AppError::new(CONFLICT))
    }

    fn unregister(&self, key: &ParsedShortcut) -> Result<(), AppError> {
        let shortcut: Shortcut = key.binding.parse().map_err(|_| AppError::new(INVALID))?;
        self.0
            .global_shortcut()
            .unregister(shortcut)
            .map_err(|_| AppError::new(UNAVAILABLE))
    }
}

fn parse_for(binding: &str, macos: bool) -> Result<Shortcut, AppError> {
    // 空绑定及长度预算由 desktop 事务检查；键码只交给插件 parser。
    let shortcut: Shortcut = binding.parse().map_err(|_| AppError::new(INVALID))?;
    let mods = shortcut.mods;
    let command = mods.intersects(Modifiers::SUPER | Modifiers::META);
    let reserved = if macos {
        !mods.intersects(Modifiers::SUPER | Modifiers::META | Modifiers::CONTROL | Modifiers::ALT)
            || (command
                && matches!(
                    shortcut.key,
                    Code::Tab
                        | Code::Space
                        | Code::Escape
                        | Code::KeyQ
                        | Code::KeyH
                        | Code::KeyM
                        | Code::KeyW
                ))
            || (mods.contains(Modifiers::CONTROL) && shortcut.key == Code::Space)
    } else {
        command
            || !mods.intersects(Modifiers::CONTROL | Modifiers::ALT)
            || (mods.contains(Modifiers::ALT)
                && matches!(
                    shortcut.key,
                    Code::Tab | Code::F4 | Code::Escape | Code::Space
                ))
            || (mods.contains(Modifiers::CONTROL) && shortcut.key == Code::Escape)
            || (mods.contains(Modifiers::CONTROL | Modifiers::ALT) && shortcut.key == Code::Delete)
    };
    if reserved {
        Err(AppError::new(INVALID))
    } else {
        Ok(shortcut)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn plugin_parser_rejects_platform_reserved_keys() {
        for binding in [
            "a",
            "Shift+A",
            "Alt+Tab",
            "Alt+F4",
            "Alt+Escape",
            "Alt+Space",
            "Ctrl+Alt+Delete",
            "Super+Q",
            "Ctrl+Escape",
        ] {
            assert!(parse_for(binding, false).is_err(), "{binding}");
        }
        for binding in [
            "Super+Q",
            "Super+H",
            "Super+M",
            "Super+W",
            "Super+Tab",
            "Super+Space",
            "Super+Escape",
            "Ctrl+Space",
            "Shift+A",
        ] {
            assert!(parse_for(binding, true).is_err(), "{binding}");
        }
        for (binding, mac) in [("Ctrl+Shift+K", false), ("Super+Shift+K", true)] {
            let key = parse_for(binding, mac).unwrap();
            assert_eq!(
                key.into_string().parse::<Shortcut>().unwrap().id(),
                key.id()
            );
        }
    }
}
