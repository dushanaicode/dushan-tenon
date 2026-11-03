#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod application;
mod boot;
mod commands;
pub mod exchange;
mod i18n;
#[cfg(test)]
mod ipc_tests;
mod lifecycle;
mod native;
mod notification;
mod ports;
pub mod state;
mod stream;
mod window;

use dushan_tenon_lib::modules;
use std::process::ExitCode;

fn main() -> ExitCode {
    match application::run() {
        Ok(0) => ExitCode::SUCCESS,
        Ok(_) => ExitCode::FAILURE,
        Err(error) => {
            eprintln!("启动失败: {error}");
            ExitCode::FAILURE
        }
    }
}
