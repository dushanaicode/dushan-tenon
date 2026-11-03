// Copyright 2019-2023 Tauri Programme within The Commons Conservancy
// SPDX-License-Identifier: Apache-2.0
// SPDX-License-Identifier: MIT

#[cfg(windows)]
use crate::{Error, Result};
#[cfg(windows)]
use std::sync::{
    Arc,
    atomic::{AtomicBool, Ordering},
};
#[cfg(windows)]
use tauri::{Runtime, Window};

/// Tauri Moved/Resized events do not identify a user gesture. After restoration or a
/// display change, retain the saved rectangle until Windows reports an actual move/size gesture.
#[cfg(windows)]
pub(crate) struct Interaction {
    suppressed: AtomicBool,
    moving: AtomicBool,
}

#[cfg(windows)]
impl Default for Interaction {
    fn default() -> Self {
        Self {
            suppressed: AtomicBool::new(true),
            moving: AtomicBool::new(false),
        }
    }
}

#[cfg(windows)]
impl Interaction {
    pub fn suppress(&self) {
        self.suppressed.store(true, Ordering::Release);
    }
    pub fn normal_changed(&self) -> bool {
        !self.suppressed.load(Ordering::Acquire)
    }

    fn message(&self, message: u32) {
        match message {
            0x0231 => {
                // WM_ENTERSIZEMOVE: mouse and system-menu keyboard gestures.
                self.moving.store(true, Ordering::Release);
                self.suppressed.store(false, Ordering::Release);
            }
            0x0232 => self.moving.store(false, Ordering::Release), // WM_EXITSIZEMOVE
            0x007E | 0x02E0 if !self.moving.load(Ordering::Acquire) => self.suppress(), // display / DPI
            _ => {}
        }
    }
}

#[cfg(windows)]
mod windows {
    use super::*;
    use std::ffi::c_void;

    type SubclassProc =
        unsafe extern "system" fn(*mut c_void, u32, usize, isize, usize, usize) -> isize;
    const ID: usize = 0x44555357;

    #[link(name = "comctl32")]
    unsafe extern "system" {
        fn SetWindowSubclass(
            window: *mut c_void,
            callback: SubclassProc,
            id: usize,
            data: usize,
        ) -> i32;
        fn RemoveWindowSubclass(window: *mut c_void, callback: SubclassProc, id: usize) -> i32;
        fn DefSubclassProc(
            window: *mut c_void,
            message: u32,
            wparam: usize,
            lparam: isize,
        ) -> isize;
    }

    unsafe extern "system" fn callback(
        window: *mut c_void,
        message: u32,
        wparam: usize,
        lparam: isize,
        _id: usize,
        data: usize,
    ) -> isize {
        // data owns exactly one Arc until WM_NCDESTROY. Only this window/thread uses the subclass.
        let interaction = unsafe { &*(data as *const Interaction) };
        interaction.message(message);
        if message == 0x0082 {
            // WM_NCDESTROY
            unsafe {
                RemoveWindowSubclass(window, callback, ID);
            }
        }
        let result = unsafe { DefSubclassProc(window, message, wparam, lparam) };
        if message == 0x0082 {
            unsafe {
                drop(Arc::from_raw(data as *const Interaction));
            }
        }
        result
    }

    pub fn install<R: Runtime>(window: &Window<R>, interaction: Arc<Interaction>) -> Result<()> {
        let handle = window.hwnd()?.0 as usize;
        let (send, receive) = std::sync::mpsc::sync_channel(1);
        window.run_on_main_thread(move || {
            let data = Arc::into_raw(interaction);
            let installed =
                unsafe { SetWindowSubclass(handle as *mut c_void, callback, ID, data as usize) }
                    != 0;
            if !installed {
                unsafe {
                    drop(Arc::from_raw(data));
                }
            }
            // The waiting caller can disappear only during shutdown; no native resource is leaked.
            let _ = send.send(installed);
        })?;
        if receive.recv().map_err(|_| Error::Unavailable)? {
            Ok(())
        } else {
            Err(Error::Unavailable)
        }
    }
}

#[cfg(windows)]
pub(crate) use windows::install;

#[cfg(not(windows))]
#[derive(Default)]
pub(crate) struct Interaction {}

#[cfg(not(windows))]
impl Interaction {
    pub fn suppress(&self) {}

    /// Cocoa/GTK window events expose observed geometry, not Win32 gesture IDs.
    /// Save normal-state observations after restoration; display adjustments are
    /// observations too. Minimized/fullscreen/maximized geometry stays excluded
    /// by WindowState::record, and unsupported window operations remain errors.
    pub fn normal_changed(&self) -> bool {
        true
    }
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;

    #[test]
    fn only_user_motion_releases_display_clamp() {
        let interaction = Interaction::default();
        assert!(!interaction.normal_changed());
        interaction.message(0x0231);
        interaction.message(0x02E0);
        assert!(interaction.normal_changed());
        interaction.message(0x0232);
        interaction.message(0x007E);
        assert!(!interaction.normal_changed());
        interaction.message(0x0005); // An OS resize is not a new user gesture.
        assert!(!interaction.normal_changed());
        interaction.message(0x0231);
        assert!(interaction.normal_changed());
    }
}
