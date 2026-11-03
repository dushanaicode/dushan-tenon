// Copyright 2019-2023 Tauri Programme within The Commons Conservancy
// SPDX-License-Identifier: Apache-2.0
// SPDX-License-Identifier: MIT

//! Explicit-path, main-window-only adaptation of window-state 2.5.0.
#![cfg(not(any(target_os = "android", target_os = "ios")))]

use bitflags::bitflags;
use std::{
    path::PathBuf,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};
use tauri::{
    LogicalSize, Monitor, PhysicalPosition, Runtime, Window, WindowEvent,
    plugin::{Builder as PluginBuilder, TauriPlugin},
};

mod interaction;
pub mod storage;
use storage::{Display, Geometry, MonitorRect, StateFile, restore_geometry};

pub type Result<T> = std::result::Result<T, Error>;

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("invalid window state")]
    Invalid,
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error(transparent)]
    Json(#[from] serde_json::Error),
    #[error(transparent)]
    Tauri(#[from] tauri::Error),
    #[error("window state unavailable")]
    Unavailable,
}

bitflags! {
    #[derive(Clone, Copy, Debug)]
    pub struct StateFlags: u32 {
        const SIZE = 1 << 0;
        const POSITION = 1 << 1;
        const MAXIMIZED = 1 << 2;
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RestoreState {
    FirstRun,
    Restored,
    Disabled,
    Failed,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Failure {
    Invalid,
    Read,
    Write,
    Window,
}

#[derive(Clone, Copy, Debug)]
pub struct Status {
    pub state: RestoreState,
    pub error: Option<Failure>,
    pub adjusted: bool,
}

struct Memory {
    enabled: bool,
    closed: bool,
    status: Status,
    geometry: Option<Geometry>,
    blocked: bool,
    dirty: bool,
    changed: Instant,
    worker: bool,
}

/// Owned by the host, which explicitly flushes it in shared shutdown.
/// No automatic Exit handler or implicit path resolver is installed.
pub struct WindowState {
    file: StateFile,
    memory: Mutex<Memory>,
    interaction: Arc<interaction::Interaction>,
}

impl WindowState {
    pub fn new(state_file: PathBuf, enabled: bool) -> Result<Arc<Self>> {
        let file = StateFile::new(state_file)?;
        let (geometry, state, error) = if enabled {
            match file.load() {
                Ok(Some(geometry)) => (Some(geometry), RestoreState::Restored, None),
                Ok(None) => (None, RestoreState::FirstRun, None),
                Err(error) => {
                    let failure = match error {
                        Error::Invalid | Error::Json(_) => Failure::Invalid,
                        _ => Failure::Read,
                    };
                    (None, RestoreState::Failed, Some(failure))
                }
            }
        } else {
            (None, RestoreState::Disabled, None)
        };
        Ok(Arc::new(Self {
            file,
            interaction: Arc::new(interaction::Interaction::default()),
            memory: Mutex::new(Memory {
                enabled,
                closed: false,
                status: Status {
                    state,
                    error,
                    adjusted: false,
                },
                geometry,
                blocked: error.is_some(),
                dirty: false,
                changed: Instant::now(),
                worker: false,
            }),
        }))
    }

    pub fn status(&self) -> Status {
        let memory = self.memory.lock().unwrap();
        let mut status = memory.status;
        if !memory.enabled {
            status.state = RestoreState::Disabled;
        }
        status
    }

    pub fn set_enabled(&self, enabled: bool) {
        let mut memory = self.memory.lock().unwrap();
        if memory.closed {
            return;
        }
        memory.enabled = enabled;
        if !enabled {
            memory.dirty = false;
        }
        if enabled && memory.status.state == RestoreState::Disabled {
            memory.status.state = RestoreState::FirstRun;
        }
    }

    pub fn geometry(&self) -> Option<Geometry> {
        self.memory.lock().unwrap().geometry.clone()
    }

    fn failed(&self, error: Failure) {
        let mut memory = self.memory.lock().unwrap();
        memory.status.state = RestoreState::Failed;
        memory.status.error = Some(error);
    }

    fn flush_locked(&self, memory: &mut Memory) -> Result<()> {
        if !memory.enabled || !memory.dirty || memory.blocked {
            return Ok(());
        }
        let geometry = memory.geometry.as_ref().expect("dirty geometry is present");
        match self.file.save(geometry) {
            Ok(()) => {
                memory.dirty = false;
                memory.status.error = None;
                if memory.status.state == RestoreState::Failed {
                    memory.status.state = RestoreState::Restored;
                }
                Ok(())
            }
            Err(error) => {
                memory.status.state = RestoreState::Failed;
                memory.status.error = Some(Failure::Write);
                Err(error)
            }
        }
    }

    pub fn flush(&self) -> Result<()> {
        self.flush_locked(&mut self.memory.lock().unwrap())
    }

    pub fn shutdown(&self) -> Result<()> {
        let mut memory = self.memory.lock().unwrap();
        let result = self.flush_locked(&mut memory);
        memory.enabled = false;
        memory.closed = true;
        memory.dirty = false;
        result
    }

    /// Maximization/minimization never replace the normal rectangle. Windows also
    /// distinguishes display clamping from user gestures through its native hook.
    pub fn record(
        self: &Arc<Self>,
        geometry: Geometry,
        minimized: bool,
        fullscreen: bool,
        normal_changed: bool,
        flags: StateFlags,
    ) {
        let mut memory = self.memory.lock().unwrap();
        if !memory.enabled || memory.blocked || minimized || fullscreen {
            return;
        }
        let previous = memory.geometry.clone();
        let mut next = match previous.as_ref() {
            Some(previous) => previous.clone(),
            None if geometry.maximized || !normal_changed => return,
            None => geometry.clone(),
        };
        if flags.contains(StateFlags::MAXIMIZED) {
            next.maximized = geometry.maximized;
        }
        if !geometry.maximized && normal_changed {
            if flags.contains(StateFlags::SIZE) {
                next.width = geometry.width;
                next.height = geometry.height;
            }
            if flags.contains(StateFlags::POSITION) {
                next.x = geometry.x;
                next.y = geometry.y;
            }
            next.scale_factor = geometry.scale_factor;
            next.monitor = geometry.monitor;
            memory.status.adjusted = false;
        }
        if previous.as_ref() == Some(&next) {
            return;
        }
        memory.geometry = Some(next);
        memory.dirty = true;
        memory.changed = Instant::now();
        if memory.worker {
            return;
        }
        memory.worker = true;
        let state = self.clone();
        // At most one worker per window; events only update memory and the debounce deadline.
        std::thread::spawn(move || {
            loop {
                std::thread::sleep(Duration::from_millis(500));
                let mut memory = state.memory.lock().unwrap();
                if memory.dirty && memory.changed.elapsed() < Duration::from_millis(500) {
                    continue;
                }
                if state.flush_locked(&mut memory).is_err() {
                    log::warn!("window-state save failed");
                }
                memory.worker = false;
                break;
            }
        });
    }

    pub fn reset(&self, geometry: Geometry) -> Result<()> {
        let mut memory = self.memory.lock().unwrap();
        if !memory.enabled {
            return Err(Error::Unavailable);
        }
        if let Err(error) = self.file.save(&geometry) {
            memory.status.state = RestoreState::Failed;
            memory.status.error = Some(Failure::Write);
            return Err(error);
        }
        memory.geometry = Some(geometry);
        memory.blocked = false;
        memory.dirty = false;
        memory.status = Status {
            state: RestoreState::Restored,
            error: None,
            adjusted: false,
        };
        Ok(())
    }
}

fn display(monitor: &Monitor) -> Display {
    let position = monitor.position();
    let size = monitor.size();
    let work = monitor.work_area();
    Display {
        rect: MonitorRect {
            x: position.x,
            y: position.y,
            width: size.width,
            height: size.height,
        },
        work_area: MonitorRect {
            x: work.position.x,
            y: work.position.y,
            width: work.size.width,
            height: work.size.height,
        },
        scale: monitor.scale_factor(),
    }
}

pub fn capture<R: Runtime>(window: &Window<R>) -> Result<Geometry> {
    let scale = window.scale_factor()?;
    let position = window.outer_position()?;
    let size = window.inner_size()?.to_logical::<f64>(scale);
    let monitor = window.current_monitor()?.ok_or(Error::Unavailable)?;
    let geometry = Geometry {
        x: position.x,
        y: position.y,
        width: size.width,
        height: size.height,
        scale_factor: scale,
        monitor: display(&monitor).rect,
        maximized: window.is_maximized()?,
    };
    geometry.validate()?;
    Ok(geometry)
}

pub fn reset_window<R: Runtime>(window: &Window<R>, state: &WindowState) -> Result<()> {
    if window.label() != "main" || state.status().state == RestoreState::Disabled {
        return Err(Error::Unavailable);
    }
    let result = (|| {
        state.interaction.suppress();
        window.unmaximize()?;
        window.unminimize()?;
        window.set_size(LogicalSize::new(1100.0, 720.0))?;
        window.center()?;
        constrain_title_bar(window)?;
        state.reset(capture(window)?)
    })();
    if matches!(result, Err(Error::Tauri(_) | Error::Unavailable)) {
        state.failed(Failure::Window);
    }
    result
}

fn constrain_title_bar<R: Runtime>(window: &Window<R>) -> Result<bool> {
    let monitor = window.current_monitor()?.ok_or(Error::Unavailable)?;
    let work = monitor.work_area();
    let outer = window.outer_size()?;
    let position = window.outer_position()?;
    let x = i64::from(position.x).clamp(
        i64::from(work.position.x),
        (i64::from(work.position.x) + i64::from(work.size.width) - i64::from(outer.width))
            .max(i64::from(work.position.x)),
    );
    let y = i64::from(position.y).clamp(
        i64::from(work.position.y),
        (i64::from(work.position.y) + i64::from(work.size.height) - i64::from(outer.height))
            .max(i64::from(work.position.y)),
    );
    let changed = x != i64::from(position.x) || y != i64::from(position.y);
    if changed {
        window.set_position(PhysicalPosition::new(x as i32, y as i32))?;
    }
    Ok(changed)
}

fn restoration_frame_dimensions(
    inner: (u32, u32),
    outer: (u32, u32),
    hidden_gtk_window: bool,
) -> Result<(u32, u32)> {
    // GTK has no mapped window-manager frame yet. Tao's initial outer-size
    // cache is populated with an origin until its first configure event.
    // Restore the requested client size without interpreting that cache as a frame.
    if hidden_gtk_window {
        return Ok((0, 0));
    }
    Ok((
        outer.0.checked_sub(inner.0).ok_or(Error::Unavailable)?,
        outer.1.checked_sub(inner.1).ok_or(Error::Unavailable)?,
    ))
}

/// The mandatory state_file is supplied by WindowState::new. Only main is registered.
pub struct Builder {
    state: Arc<WindowState>,
    flags: StateFlags,
}

impl Builder {
    pub fn new(state: Arc<WindowState>) -> Self {
        Self {
            state,
            flags: StateFlags::SIZE | StateFlags::POSITION | StateFlags::MAXIMIZED,
        }
    }

    pub fn with_state_flags(mut self, flags: StateFlags) -> Self {
        self.flags = flags;
        self
    }

    pub fn build<R: Runtime>(self) -> TauriPlugin<R> {
        PluginBuilder::new("window-state")
            .on_window_ready(move |window| {
                if window.label() != "main" {
                    return;
                }
                let state = self.state.clone();
                let restore = || -> Result<()> {
                    #[cfg(windows)]
                    interaction::install(&window, state.interaction.clone())?;
                    let saved = state.geometry();
                    if state.status().state == RestoreState::Restored {
                        let saved = saved.expect("restored geometry was loaded");
                        let monitors = window
                            .available_monitors()?
                            .iter()
                            .map(display)
                            .collect::<Vec<_>>();
                        let primary =
                            display(&window.primary_monitor()?.ok_or(Error::Unavailable)?);
                        let inner = window.inner_size()?;
                        let outer = window.outer_size()?;
                        let hidden_gtk_window =
                            cfg!(target_os = "linux") && !window.is_visible()?;
                        let frame = restoration_frame_dimensions(
                            (inner.width, inner.height),
                            (outer.width, outer.height),
                            hidden_gtk_window,
                        )?;
                        let (geometry, adjusted) =
                            restore_geometry(&saved, &monitors, &primary, frame, (720.0, 540.0));
                        if self.flags.contains(StateFlags::POSITION) {
                            window.set_position(PhysicalPosition::new(geometry.x, geometry.y))?;
                        }
                        if self.flags.contains(StateFlags::SIZE) {
                            window.set_size(LogicalSize::new(geometry.width, geometry.height))?;
                        }
                        let adjusted =
                            (!hidden_gtk_window && constrain_title_bar(&window)?) || adjusted;
                        if self.flags.contains(StateFlags::MAXIMIZED) && saved.maximized {
                            window.maximize()?;
                        }
                        state.memory.lock().unwrap().status.adjusted = adjusted;
                        if adjusted {
                            log::info!("window-state position adjusted");
                        }
                    } else if saved.is_none() && !state.memory.lock().unwrap().blocked {
                        let geometry = capture(&window)?;
                        let mut memory = state.memory.lock().unwrap();
                        memory.geometry = Some(geometry);
                        memory.dirty = memory.enabled;
                    }
                    Ok(())
                };
                if restore().is_err() {
                    state.failed(Failure::Window);
                }
                let event_window = window.clone();
                let flags = self.flags;
                window.on_window_event(move |event| {
                    if !matches!(
                        event,
                        WindowEvent::Moved(_)
                            | WindowEvent::Resized(_)
                            | WindowEvent::ScaleFactorChanged { .. }
                    ) {
                        return;
                    }
                    let observed = || -> Result<()> {
                        let minimized = event_window.is_minimized()?;
                        let fullscreen = event_window.is_fullscreen()?;
                        if minimized || fullscreen {
                            return Ok(());
                        }
                        state.record(
                            capture(&event_window)?,
                            false,
                            false,
                            state.interaction.normal_changed(),
                            flags,
                        );
                        Ok(())
                    };
                    if observed().is_err() {
                        state.failed(Failure::Window);
                    }
                });
            })
            .build()
    }
}

#[cfg(test)]
mod tests;
