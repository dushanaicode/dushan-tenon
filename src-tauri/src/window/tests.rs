use super::*;
use std::process::Command;
use tenon_desktop::config::{self, Theme};

#[test]
fn reveal_waits_for_initialization_and_is_idempotent() {
    let reveal = WindowReveal::default();
    reveal.loaded.store(true, Ordering::Release);
    assert!(
        !reveal
            .show(false, || panic!("window is not initialized"))
            .unwrap()
    );
    reveal.armed.store(true, Ordering::Release);
    let mut calls = 0;
    assert!(
        reveal
            .show(false, || {
                calls += 1;
                Ok(())
            })
            .unwrap()
    );
    assert!(
        !reveal
            .show(false, || panic!("deadline must not show twice"))
            .unwrap()
    );
    assert_eq!(calls, 1);
}

#[test]
fn failed_show_can_retry_but_shutdown_prevents_reveal() {
    let reveal = WindowReveal::default();
    reveal.armed.store(true, Ordering::Release);
    assert!(
        reveal
            .show(false, || Err(AppError::new(INTERNAL_UNEXPECTED)))
            .is_err()
    );
    assert!(
        !reveal
            .show(true, || panic!("shutdown cannot show"))
            .unwrap()
    );
    assert!(reveal.show(false, || Ok(())).unwrap());
}

#[test]
fn initial_script_applies_light_dark_system_and_respects_origin() {
    let root = crate::boot::tests::root();
    let config = config::load(root.path(), [], &[]).unwrap();
    for (mode, name) in [
        (Theme::Light, "light"),
        (Theme::Dark, "dark"),
        (Theme::System, "system"),
    ] {
        let mut settings = config.settings();
        settings.theme.value = mode;
        let script = initialization_script(&settings, "http://tauri.localhost", "null").unwrap();
        // 执行生成的 JavaScript，验证真实 DOM 修改和来源门控，非源码子串断言。
        let harness = r#"
const assert = require('node:assert/strict');
const vm = require('node:vm');
for (const systemDark of [false, true]) for (const trusted of [false, true]) for (const ready of [false, true]) {
  let dark, observer;
  const root = {classList:{toggle:(name, value)=>{assert.equal(name,'dark'); dark=value;}},style:{}};
  const document = {documentElement: ready ? root : null};
  const window = {location:{protocol:'http:',host:trusted?'tauri.localhost':'untrusted.localhost'},matchMedia:()=>({matches:systemDark})};
  window.top = window;
  const context = {window,document,MutationObserver:class{constructor(fn){observer=fn;}observe(){}disconnect(){}}};
  vm.runInNewContext(process.argv[1],context);
  if (!ready && trusted) {document.documentElement=root; observer();}
  if (trusted) {
    assert.equal(dark, process.argv[2]==='dark'||(process.argv[2]==='system'&&systemDark));
    assert.equal(root.style.colorScheme,dark?'dark':'light');
    assert.equal(window.__TENON_INITIAL_SETTINGS__.settings.theme.value, process.argv[2]);
  } else {assert.equal(dark,undefined); assert.equal(window.__TENON_INITIAL_SETTINGS__,undefined);}
}
const window={top:{},location:{protocol:'http:',host:'tauri.localhost'}};
vm.runInNewContext(process.argv[1],{window});
assert.equal(window.__TENON_INITIAL_SETTINGS__,undefined);
"#;
        let output = Command::new("node")
            .args(["-e", harness, &script, name])
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
    }
}

#[test]
fn secondary_launch_rejects_other_root_queues_once_and_stops_on_shutdown() {
    let current = crate::boot::tests::root();
    let other = crate::boot::tests::root();
    let lifecycle = Lifecycle::new();
    let app = crate::boot::tests::app();
    lifecycle
        .window
        .set_root(current.path().canonicalize().unwrap())
        .unwrap();
    secondary_launch(
        app.handle(),
        vec![
            "app".into(),
            "--state-root".into(),
            other.path().display().to_string(),
        ],
        ".".into(),
        &lifecycle,
    );
    assert!(!lifecycle.window.ready().unwrap());
    let lifecycle = Lifecycle::new();
    secondary_launch(
        app.handle(),
        vec!["app".into(), "--set".into(), "auth.mode=login".into()],
        ".".into(),
        &lifecycle,
    );
    lifecycle
        .window
        .set_root(current.path().canonicalize().unwrap())
        .unwrap();
    assert!(lifecycle.window.ready().unwrap());
    assert!(!lifecycle.window.ready().unwrap());
    lifecycle.exit.begin();
    assert!(!lifecycle.window.request_show(None).unwrap());
}
