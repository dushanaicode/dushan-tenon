#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod application;
mod boot;
mod commands;
mod data;
mod diagnostics;
pub mod exchange;
mod file_ingress;
mod i18n;
#[cfg(test)]
mod ipc_tests;
mod lifecycle;
mod native;
mod notification;
mod picked_files;
mod ports;
mod restore;
mod startup_recovery;
pub mod state;
mod stream;
mod window;

use dushan_tenon_lib::modules;
use std::process::ExitCode;

fn main() -> ExitCode {
    match application::run() {
        Ok(0) => ExitCode::SUCCESS,
        Ok(_) => ExitCode::FAILURE,
        Err(_) => {
            eprintln!("宿主未能启动，详见启动故障提示。");
            ExitCode::FAILURE
        }
    }
}
