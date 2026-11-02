//! 最小快照的白名单纯文本；宿主收集事实、鉴权和解析令牌，framework 打包。

use std::path::Path;

use tenon_framework::{
    backup,
    cache::CacheProvider,
    db::DatabaseKind,
    error::{AppError, ErrorCode},
    i18n::Language,
};

use crate::{config::Theme, data::FileArtifact};

pub const NEEDS_PROBE: ErrorCode = ErrorCode::new("app.diagnostics.needs_probe");
pub const EXPORT_FAILED: ErrorCode = ErrorCode::new("app.diagnostics.export_failed");

pub enum CacheStatus {
    Connected,
    Error { code: ErrorCode },
}

pub struct DiagnosticModule {
    pub id: String,
    pub version: String,
    pub enabled: bool,
    pub core: bool,
}

/// 不接收 AppAbout、配置对象或错误对象，避免渲染时意外带入私有字段。
pub struct DiagnosticSnapshot {
    pub version: String,
    pub database_kind: DatabaseKind,
    pub applied_migrations: usize,
    pub cache_provider: CacheProvider,
    pub cache_status: Option<CacheStatus>,
    pub language: Language,
    pub theme: Theme,
    pub modules: Vec<DiagnosticModule>,
}

fn safe_label(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"._-+".contains(&byte))
}

pub fn render(snapshot: &DiagnosticSnapshot) -> Result<String, AppError> {
    let probe = snapshot
        .cache_status
        .as_ref()
        .ok_or_else(|| AppError::new(NEEDS_PROBE))?;
    if !safe_label(&snapshot.version)
        || snapshot
            .modules
            .iter()
            .any(|module| !safe_label(&module.id) || !safe_label(&module.version))
    {
        return Err(AppError::new(EXPORT_FAILED));
    }
    let mut lines = vec![
        "Dushan Tenon diagnostics v1".into(),
        format!("version: {}", snapshot.version),
        format!(
            "database.kind: {}",
            match snapshot.database_kind {
                DatabaseKind::Sqlite => "sqlite",
                DatabaseKind::Mysql => "mysql",
                DatabaseKind::Postgres => "postgres",
            }
        ),
        format!(
            "database.appliedMigrations: {}",
            snapshot.applied_migrations
        ),
        format!(
            "cache.provider: {}",
            match snapshot.cache_provider {
                CacheProvider::Local => "local",
                CacheProvider::Redis => "redis",
            }
        ),
    ];
    match probe {
        CacheStatus::Connected => lines.push("cache.status: connected".into()),
        CacheStatus::Error { code } => {
            lines.push("cache.status: error".into());
            lines.push(format!("cache.errorCode: {code}"));
        }
    }
    lines.extend([
        format!(
            "ui.language: {}",
            match snapshot.language {
                Language::ZhCn => "zh-CN",
                Language::EnUs => "en-US",
            }
        ),
        format!(
            "ui.theme: {}",
            match snapshot.theme {
                Theme::Light => "light",
                Theme::Dark => "dark",
                Theme::System => "system",
            }
        ),
        "modules:".into(),
    ]);
    let mut modules: Vec<_> = snapshot.modules.iter().collect();
    modules.sort_by(|left, right| left.id.cmp(&right.id));
    lines.extend(modules.into_iter().map(|module| {
        format!(
            "  {} {} {} {}",
            module.id,
            module.version,
            if module.enabled {
                "enabled"
            } else {
                "disabled"
            },
            if module.core { "core" } else { "optional" }
        )
    }));
    lines.extend(["paths: [redacted]".into(), "endpoints: [redacted]".into()]);
    Ok(lines.join("\n"))
}

/// 同步文件操作，由宿主放入 blocking worker；只写已解析的诊断导出目标。
pub fn export(
    snapshot: &DiagnosticSnapshot,
    root: &Path,
    scratch: &Path,
    destination: &Path,
) -> Result<FileArtifact, AppError> {
    let text = render(snapshot)?;
    let (bytes, sha256) = backup::export_diagnostics(text.as_bytes(), root, scratch, destination)
        .map_err(|error| {
        AppError::new(if error.code() == backup::STORAGE_UNSUPPORTED {
            backup::STORAGE_UNSUPPORTED
        } else {
            EXPORT_FAILED
        })
    })?;
    Ok(FileArtifact { bytes, sha256 })
}

#[cfg(test)]
mod tests {
    use super::*;
    use sha2::{Digest, Sha256};
    use std::fs;

    fn snapshot() -> DiagnosticSnapshot {
        DiagnosticSnapshot {
            version: "0.1.0-test".into(),
            database_kind: DatabaseKind::Postgres,
            applied_migrations: 3,
            cache_provider: CacheProvider::Redis,
            cache_status: Some(CacheStatus::Connected),
            language: Language::EnUs,
            theme: Theme::System,
            modules: vec![
                DiagnosticModule {
                    id: "notify".into(),
                    version: "0.2.0".into(),
                    enabled: false,
                    core: false,
                },
                DiagnosticModule {
                    id: "account".into(),
                    version: "0.1.0".into(),
                    enabled: true,
                    core: true,
                },
                DiagnosticModule {
                    id: "Z_test".into(),
                    version: "1.0.0".into(),
                    enabled: true,
                    core: false,
                },
            ],
        }
    }

    #[test]
    fn diagnostic_text_matches_whitelist() {
        let mut snapshot = snapshot();
        assert_eq!(
            render(&snapshot).unwrap(),
            [
                "Dushan Tenon diagnostics v1",
                "version: 0.1.0-test",
                "database.kind: postgres",
                "database.appliedMigrations: 3",
                "cache.provider: redis",
                "cache.status: connected",
                "ui.language: en-US",
                "ui.theme: system",
                "modules:",
                "  Z_test 1.0.0 enabled optional",
                "  account 0.1.0 enabled core",
                "  notify 0.2.0 disabled optional",
                "paths: [redacted]",
                "endpoints: [redacted]",
            ]
            .join("\n")
        );
        let error = AppError::new(tenon_framework::cache::CACHE_UNAVAILABLE)
            .with_param("secret", "private-config-sentinel")
            .with_source(std::io::Error::other("private-endpoint-sentinel"));
        snapshot.cache_status = Some(CacheStatus::Error { code: error.code() });
        let text = render(&snapshot).unwrap();
        assert!(text.contains("cache.status: error\ncache.errorCode: app.cache.unavailable\n"));
        assert!(!text.contains("sentinel"));
        for field in [
            "preset:",
            "accent:",
            "density:",
            "motion:",
            "developer_mode",
            "source:",
        ] {
            assert!(!text.contains(field));
        }
        assert!(!text.ends_with('\n'));
        assert!(!text.contains('\r'));
    }

    #[test]
    fn export_requires_probe_and_rejects_text_injection() {
        let mut snapshot = snapshot();
        snapshot.cache_status = None;
        assert_eq!(render(&snapshot).unwrap_err().code(), NEEDS_PROBE);
        snapshot.cache_status = Some(CacheStatus::Connected);
        for invalid in [
            "\nsecret: value",
            "C:\\private",
            "https://private",
            "user@example.com",
            "",
        ] {
            snapshot.version = invalid.into();
            assert_eq!(render(&snapshot).unwrap_err().code(), EXPORT_FAILED);
            snapshot.version = "1.0.0".into();
            snapshot.modules[0].id = invalid.into();
            assert_eq!(render(&snapshot).unwrap_err().code(), EXPORT_FAILED);
            snapshot.modules[0].id = "notify".into();
            snapshot.modules[0].version = invalid.into();
            assert_eq!(render(&snapshot).unwrap_err().code(), EXPORT_FAILED);
            snapshot.modules[0].version = "1.0.0".into();
        }
    }

    #[test]
    fn export_packages_only_rendered_snapshot_and_preserves_target_on_failure() {
        let temp = tempfile::tempdir_in(std::env::var_os("TEMP").expect("isolated TEMP")).unwrap();
        let root = temp.path().join("private-state-sentinel");
        fs::create_dir(&root).unwrap();
        fs::write(
            root.join("private-config-sentinel"),
            "private-secret-sentinel",
        )
        .unwrap();
        let destination = temp.path().join("copy.tenon-diagnostics.zip");
        let scratch = root.join("Temp/diagnostics");
        let mut snapshot = snapshot();
        let artifact = export(&snapshot, &root, &scratch, &destination).unwrap();
        let bytes = fs::read(&destination).unwrap();
        assert_eq!(artifact.bytes, bytes.len() as u64);
        assert_eq!(artifact.sha256, format!("{:x}", Sha256::digest(&bytes)));
        assert!(
            bytes
                .windows(render(&snapshot).unwrap().len())
                .any(|part| part == render(&snapshot).unwrap().as_bytes())
        );
        assert!(!String::from_utf8_lossy(&bytes).contains("sentinel"));
        snapshot.cache_status = None;
        assert_eq!(
            export(&snapshot, &root, &scratch, &destination)
                .err()
                .unwrap()
                .code(),
            NEEDS_PROBE
        );
        assert_eq!(fs::read(destination).unwrap(), bytes);
    }
}
