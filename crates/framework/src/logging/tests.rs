use std::{fs, process::Command};

use super::*;

#[test]
fn non_blocking_logs_flush_as_json_and_respect_level_without_global_subscriber() {
    let root = tempfile::Builder::new()
        .prefix("tenon-logging-")
        .tempdir_in(std::env::temp_dir())
        .unwrap();
    let config = LoggingConfig {
        level: LogLevel::Warn,
        ..Default::default()
    };
    let (subscriber, guard, _) = build_subscriber(root.path(), &config).unwrap();
    tracing::subscriber::with_default(subscriber, || {
        record_startup(
            root.path(),
            &StartupRecord {
                version: "test-version".into(),
                config_file_exists: false,
                environment_keys: vec![],
                command_line_keys: vec!["logging.level".into()],
            },
        );
        tracing::info!("filtered message");
        tracing::warn!("test message with \"quotes\"\nand a newline");
    });
    drop(guard);

    let files = fs::read_dir(root.path().join("logs"))
        .unwrap()
        .map(|entry| entry.unwrap().path())
        .collect::<Vec<_>>();
    assert_eq!(files.len(), 1);
    assert_eq!(files[0].extension().unwrap(), "jsonl");
    // pnpm test 已要求 Node；使用其标准 JSON 解析器，无需新增 JSON 测试依赖。
    let result = Command::new("node")
        .arg("-e")
        .arg(
            r#"
        const assert = require('node:assert/strict');
        const fs = require('node:fs');
        const lines = fs.readFileSync(process.argv[1], 'utf8').trimEnd().split('\n');
        const records = lines.map(line => JSON.parse(line));
        assert.equal(records.length, 2);
        const startup = records[0];
        assert.equal(startup.level, 'INFO');
        assert.equal(startup.fields.message, '应用启动');
        assert.equal(startup.fields.version, 'test-version');
        assert.equal(startup.fields.config_file_exists, false);
        assert.ok(startup.fields.state_root);
        assert.equal(startup.fields.command_line_keys, '["logging.level"]');
        assert.equal(startup.fields.environment_keys, '[]');
        assert.ok(!lines[0].includes('warn'));
        assert.equal(records[1].level, 'WARN');
        assert.equal(records[1].fields.message, 'test message with "quotes"\nand a newline');
    "#,
        )
        .arg(&files[0])
        .output()
        .unwrap();
    assert!(
        result.status.success(),
        "{}",
        String::from_utf8_lossy(&result.stderr)
    );
}

#[test]
fn log_directory_failure_returns_error() {
    let root = tempfile::Builder::new()
        .prefix("tenon-logging-")
        .tempdir_in(std::env::temp_dir())
        .unwrap();
    fs::write(root.path().join("logs"), "not a directory").unwrap();
    let result = build_subscriber(root.path(), &LoggingConfig::default());
    assert!(
        matches!(result, Err(LoggingError::Directory { ref path, .. }) if path == &root.path().join("logs"))
    );
}

#[test]
fn reload_handle_changes_filter_on_existing_callsites_and_keeps_startup_records() {
    let root = tempfile::Builder::new()
        .prefix("tenon-reload-")
        .tempdir_in(std::env::temp_dir())
        .unwrap();
    let config = LoggingConfig {
        level: LogLevel::Warn,
        ..Default::default()
    };
    let (subscriber, guard, handle) = build_subscriber(root.path(), &config).unwrap();
    tracing::subscriber::with_default(subscriber, || {
        for (phase, level) in [LogLevel::Warn, LogLevel::Debug, LogLevel::Error]
            .into_iter()
            .enumerate()
        {
            handle.set_level(level).unwrap();
            tracing::debug!(phase, "debug event");
            tracing::warn!(phase, "warn event");
        }
        record_startup(
            root.path(),
            &StartupRecord {
                version: "reload-test".into(),
                config_file_exists: false,
                environment_keys: vec![],
                command_line_keys: vec!["logging.level".into()],
            },
        );
    });
    drop(guard);
    let path = fs::read_dir(root.path().join("logs"))
        .unwrap()
        .next()
        .unwrap()
        .unwrap()
        .path();
    let text = fs::read_to_string(path).unwrap();
    let records: Vec<serde_json::Value> = text
        .lines()
        .map(|line| serde_json::from_str(line).unwrap())
        .collect();
    assert_eq!(records.len(), 4, "{text}");
    assert_eq!(records[0]["fields"]["phase"], 0);
    assert_eq!(records[0]["level"], "WARN");
    assert_eq!(records[1]["fields"]["phase"], 1);
    assert_eq!(records[1]["level"], "DEBUG");
    assert_eq!(records[2]["fields"]["phase"], 1);
    assert_eq!(records[2]["level"], "WARN");
    assert_eq!(records[3]["fields"]["version"], "reload-test");
}

#[test]
fn reload_after_subscriber_drop_returns_error() {
    let root = tempfile::tempdir().unwrap();
    let (subscriber, guard, handle) =
        build_subscriber(root.path(), &LoggingConfig::default()).unwrap();
    drop(subscriber);
    assert!(matches!(
        handle.set_level(LogLevel::Debug),
        Err(LoggingError::Reload(_))
    ));
    drop(guard);
}
