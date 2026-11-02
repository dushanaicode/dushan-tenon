//! 数据库原始字段只用于加载；远端必填项在构造已校验连接时取出。

use std::{
    num::{NonZeroU16, NonZeroUsize},
    path::{Path, PathBuf},
};

use serde::Deserialize;
use tenon_framework::{
    db::{DatabaseConfig, DatabaseConnection, DatabaseKind, RemoteDatabaseConfig},
    network::TlsMode,
};

use super::{ConfigError, remote::secret_and_ca};

#[derive(Deserialize)]
#[serde(default, deny_unknown_fields)]
pub(super) struct RawDatabase {
    kind: DatabaseKind,
    backup_keep: NonZeroUsize,
    host: Option<String>,
    port: Option<NonZeroU16>,
    name: Option<String>,
    username: Option<String>,
    password_secret: Option<String>,
    tls: Option<TlsMode>,
    tls_ca_file: Option<PathBuf>,
}

impl Default for RawDatabase {
    fn default() -> Self {
        Self {
            kind: DatabaseKind::Sqlite,
            backup_keep: const { NonZeroUsize::new(5).unwrap() },
            host: None,
            port: None,
            name: None,
            username: None,
            password_secret: None,
            tls: None,
            tls_ca_file: None,
        }
    }
}

impl RawDatabase {
    pub(super) fn into_config(self, root: &Path) -> Result<DatabaseConfig, ConfigError> {
        let field = |key: &str, reason: &str| ConfigError::field(format!("database.{key}"), reason);
        if self.kind == DatabaseKind::Sqlite {
            for (key, present) in [
                ("host", self.host.is_some()),
                ("port", self.port.is_some()),
                ("name", self.name.is_some()),
                ("username", self.username.is_some()),
                ("password_secret", self.password_secret.is_some()),
                ("tls", self.tls.is_some()),
                ("tls_ca_file", self.tls_ca_file.is_some()),
            ] {
                if present {
                    return Err(field(key, "SQLite 不接受远端数据库字段"));
                }
            }
            return Ok(DatabaseConfig {
                connection: DatabaseConnection::Sqlite,
                backup_keep: self.backup_keep,
            });
        }
        let required = |key: &str, value: Option<String>| {
            let value = value.ok_or_else(|| field(key, "远端数据库必填字段"))?;
            if value.trim().is_empty() || value.contains('\0') {
                return Err(field(key, "必须为非空且不含 NUL 的字符串"));
            }
            Ok(value)
        };
        let host = required("host", self.host)?;
        let name = required("name", self.name)?;
        let username = required("username", self.username)?;
        if host
            .chars()
            .any(|c| c.is_whitespace() || matches!(c, '/' | '\\' | '@' | '?' | '#'))
        {
            return Err(field(
                "host",
                "必须为主机名或 IP，不接受 URL 或 socket 路径",
            ));
        }
        let port = self
            .port
            .ok_or_else(|| field("port", "远端数据库必填字段"))?;
        let password_secret = self
            .password_secret
            .unwrap_or_else(|| "database.password".into());
        let tls_ca_file = secret_and_ca("database", &password_secret, self.tls_ca_file, root)?;
        let remote = RemoteDatabaseConfig {
            host,
            port,
            name,
            username,
            password_secret,
            tls: self.tls.unwrap_or_default(),
            tls_ca_file,
        };
        let connection = if self.kind == DatabaseKind::Mysql {
            DatabaseConnection::Mysql(remote)
        } else {
            DatabaseConnection::Postgres(remote)
        };
        Ok(DatabaseConfig {
            connection,
            backup_keep: self.backup_keep,
        })
    }
}
