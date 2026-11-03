use crate::{boot, lifecycle::Lifecycle, state::AppState};
use serde_json::Value;
use std::{fs, path::Path, sync::Arc};
use tauri::{
    Manager, WebviewUrl, WebviewWindow,
    ipc::{CallbackFn, InvokeBody},
    test::{INVOKE_KEY, MockRuntime, get_ipc_response},
    webview::InvokeRequest,
};

mod capability;
mod file_data;
mod files;
mod job_watch;
mod maintenance;
mod notify;
mod preset_matrix;
mod settings;
mod updater;
mod window_controls;
mod workbench;

fn with_host(
    name: &str,
    config: &str,
    prepare: impl FnOnce(&mut AppState),
    test: impl FnOnce(&WebviewWindow<MockRuntime>, &Path),
) {
    with_host_ports(name, config, boot::tests::ports(), prepare, test);
}

fn with_host_ports(
    name: &str,
    config: &str,
    ports: boot::Ports,
    prepare: impl FnOnce(&mut AppState),
    test: impl FnOnce(&WebviewWindow<MockRuntime>, &Path),
) {
    with_host_options(name, config, boot::Options::default(), ports, prepare, test);
}

fn with_host_options(
    name: &str,
    config: &str,
    mut options: boot::Options,
    ports: boot::Ports,
    prepare: impl FnOnce(&mut AppState),
    test: impl FnOnce(&WebviewWindow<MockRuntime>, &Path),
) {
    if !boot::tests::child(name) {
        return;
    }
    let root = boot::tests::root();
    fs::write(root.path().join("config.toml"), config).unwrap();
    let app = boot::tests::app();
    let lifecycle = Arc::new(Lifecycle::new());
    options.state_root = Some(root.path().into());
    let mut running =
        tauri::async_runtime::block_on(boot::initialize(app.handle(), options, &lifecycle, ports))
            .unwrap();
    prepare(&mut running.state);
    let shutdown = running.shutdown;
    lifecycle.install(shutdown.clone()).unwrap();
    app.manage(lifecycle.clone());
    app.manage(running.state);
    let window =
        tauri::WebviewWindowBuilder::new(&app, "main", WebviewUrl::App("index.html".into()))
            .build()
            .unwrap();
    window
        .state::<AppState>()
        .native
        .tray
        .start(&window.state::<AppState>().config)
        .unwrap();
    test(&window, root.path());
    tauri::async_runtime::block_on(shutdown.shutdown());
}

fn invoke(window: &WebviewWindow<MockRuntime>, command: &str, body: Value) -> Result<Value, Value> {
    get_ipc_response(
        window,
        InvokeRequest {
            cmd: command.into(),
            callback: CallbackFn(0),
            error: CallbackFn(1),
            url: window.url().unwrap(),
            body: InvokeBody::Json(body),
            headers: Default::default(),
            invoke_key: INVOKE_KEY.into(),
        },
    )
    .map(|response| response.deserialize().unwrap())
}
