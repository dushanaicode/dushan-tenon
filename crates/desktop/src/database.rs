//! 根内数据库路径及展示位置；连接复用 framework，命令行参数留宿主。

use std::path::{Path, PathBuf};

use tenon_framework::db::{DatabaseConfig, DatabaseConnection};

pub fn path(state_root: &Path) -> PathBuf {
    state_root.join("data").join("app.db")
}

/// 仅供已授权的本机界面显示；诊断快照不得包含此投影。
pub fn location(state_root: &Path, config: &DatabaseConfig) -> String {
    match &config.connection {
        DatabaseConnection::Sqlite => path(state_root).display().to_string(),
        DatabaseConnection::Mysql(remote) | DatabaseConnection::Postgres(remote) => {
            let host = if remote.host.contains(':') {
                format!("[{}]", remote.host)
            } else {
                remote.host.clone()
            };
            format!("{host}:{}/{}", remote.port, remote.name)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn location_projects_sqlite_and_ipv6_without_credentials() {
        let root = tempfile::tempdir_in(std::env::var_os("TEMP").expect("isolated TEMP")).unwrap();
        let config = crate::config::load(root.path(), [], &[]).unwrap();
        assert_eq!(path(root.path()), root.path().join("data/app.db"));
        let sqlite_location = location(root.path(), config.database());
        assert_eq!(sqlite_location, path(root.path()).display().to_string());
        assert!(
            sqlite_location.ends_with(&format!(
                "{sep}data{sep}app.db",
                sep = std::path::MAIN_SEPARATOR
            )),
            "{sqlite_location}"
        );
        for kind in ["mysql", "postgres"] {
            let config = crate::config::load(
                root.path(),
                [],
                &[
                    format!("database.kind={kind}"),
                    "database.host=::1".into(),
                    "database.port=5432".into(),
                    "database.name=business".into(),
                    "database.username=private-user-sentinel".into(),
                ],
            )
            .unwrap();
            assert_eq!(
                location(root.path(), config.database()),
                "[::1]:5432/business"
            );
        }
    }
}
