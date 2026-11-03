// Copyright 2019-2023 Tauri Programme within The Commons Conservancy
// SPDX-License-Identifier: Apache-2.0
// SPDX-License-Identifier: MIT

use std::{
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    path::PathBuf,
    sync::atomic::{AtomicU64, Ordering},
};

use serde::{Deserialize, Serialize};

use crate::{Error, Result};

const MAX_BYTES: u64 = 64 * 1024;
static NEXT_FILE: AtomicU64 = AtomicU64::new(0);

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MonitorRect {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Geometry {
    pub x: i32,
    pub y: i32,
    pub width: f64,
    pub height: f64,
    pub scale_factor: f64,
    pub monitor: MonitorRect,
    pub maximized: bool,
}

impl Geometry {
    pub fn validate(&self) -> Result<()> {
        if [self.width, self.height, self.scale_factor]
            .into_iter()
            .any(|value| !value.is_finite() || value <= 0.0)
            || self.monitor.width == 0
            || self.monitor.height == 0
        {
            return Err(Error::Invalid);
        }
        Ok(())
    }
}

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Document {
    version: u8,
    main: Geometry,
}

/// All filesystem operations derive exclusively from this mandatory absolute path.
pub struct StateFile {
    path: PathBuf,
}

impl StateFile {
    pub fn new(state_file: PathBuf) -> Result<Self> {
        if !state_file.is_absolute() || state_file.file_name().is_none() {
            return Err(Error::Invalid);
        }
        Ok(Self { path: state_file })
    }

    pub fn load(&self) -> Result<Option<Geometry>> {
        let file = match File::open(&self.path) {
            Ok(file) => file,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(error) => return Err(Error::Io(error)),
        };
        let mut bytes = Vec::new();
        file.take(MAX_BYTES + 1).read_to_end(&mut bytes)?;
        if bytes.len() as u64 > MAX_BYTES {
            return Err(Error::Invalid);
        }
        let document: Document = serde_json::from_slice(&bytes)?;
        if document.version != 1 {
            return Err(Error::Invalid);
        }
        document.main.validate()?;
        Ok(Some(document.main))
    }

    pub fn save(&self, geometry: &Geometry) -> Result<()> {
        geometry.validate()?;
        let bytes = serde_json::to_vec_pretty(&Document {
            version: 1,
            main: geometry.clone(),
        })?;
        let parent = self
            .path
            .parent()
            .expect("absolute state file has a parent");
        // The scratch file shares the destination volume and is never placed in OS temp.
        let scratch = parent.join("Temp");
        fs::create_dir_all(&scratch)?;
        let temporary = scratch.join(format!(
            "window-state-{}-{}.tmp",
            std::process::id(),
            NEXT_FILE.fetch_add(1, Ordering::Relaxed)
        ));
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary)?;
        let written = (|| {
            file.write_all(&bytes)?;
            file.sync_all()?;
            drop(file);
            // Rust uses replacement semantics on Windows as well as POSIX.
            fs::rename(&temporary, &self.path)
        })();
        if written.is_err() {
            // Only our exclusively created file can be removed here, never the old state.
            if let Err(error) = fs::remove_file(&temporary) {
                log::warn!("window-state scratch cleanup failed: {:?}", error.kind());
            }
        }
        written.map_err(Error::Io)
    }
}

/// Current display geometry; work area excludes taskbars and docked system UI.
#[derive(Clone, Debug, PartialEq)]
pub struct Display {
    pub rect: MonitorRect,
    pub work_area: MonitorRect,
    pub scale: f64,
}

/// Keep logical client size; translate the old monitor-relative logical offset.
pub fn restore_geometry(
    saved: &Geometry,
    displays: &[Display],
    primary: &Display,
    frame: (u32, u32),
    minimum: (f64, f64),
) -> (Geometry, bool) {
    let matched = displays
        .iter()
        .find(|display| display.rect.x == saved.monitor.x && display.rect.y == saved.monitor.y);
    let display = matched.unwrap_or(primary);
    let work = display.work_area;
    let width = saved
        .width
        .min((f64::from(work.width) - f64::from(frame.0)) / display.scale)
        .max(minimum.0);
    let height = saved
        .height
        .min((f64::from(work.height) - f64::from(frame.1)) / display.scale)
        .max(minimum.1);
    let outer_width = width * display.scale + f64::from(frame.0);
    let outer_height = height * display.scale + f64::from(frame.1);
    let (x, y) = if matched.is_some() {
        (
            f64::from(display.rect.x)
                + (f64::from(saved.x) - f64::from(saved.monitor.x)) / saved.scale_factor
                    * display.scale,
            f64::from(display.rect.y)
                + (f64::from(saved.y) - f64::from(saved.monitor.y)) / saved.scale_factor
                    * display.scale,
        )
    } else {
        (
            f64::from(work.x) + (f64::from(work.width) - outer_width) / 2.0,
            f64::from(work.y) + (f64::from(work.height) - outer_height) / 2.0,
        )
    };
    let left = f64::from(work.x);
    let top = f64::from(work.y);
    let restored = Geometry {
        x: x.clamp(left, (left + f64::from(work.width) - outer_width).max(left))
            .round() as i32,
        y: y.clamp(top, (top + f64::from(work.height) - outer_height).max(top))
            .round() as i32,
        width,
        height,
        scale_factor: display.scale,
        monitor: display.rect,
        maximized: saved.maximized,
    };
    let adjusted = matched.is_none()
        || x.round() != f64::from(restored.x)
        || y.round() != f64::from(restored.y)
        || width != saved.width
        || height != saved.height;
    (restored, adjusted)
}
