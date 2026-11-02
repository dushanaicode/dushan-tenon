use std::{fmt, fs, path::Path};

use secrecy::{ExposeSecret, SecretString};
use sqlx::{
    mysql::{MySqlConnectOptions, MySqlSslMode},
    postgres::{PgConnectOptions, PgSslMode},
};

use super::{
    CONNECTION_FAILED, DatabaseConfig, DatabaseConnection, Db, RemoteDatabaseConfig, TLS_FAILED,
    internal,
};
use crate::{
    error::{AppError, INPUT_INVALID},
    network::TlsMode,
    secret::{CredentialBackend, SecretStore},
};

impl Db {
    pub async fn connect(
        config: &DatabaseConfig,
        secrets: &SecretStore<impl CredentialBackend>,
        state_root: &Path,
    ) -> Result<Self, AppError> {
        match &config.connection {
            DatabaseConnection::Sqlite => {
                let directory = state_root.join("data");
                fs::create_dir_all(&directory).map_err(internal)?;
                Self::open_sqlite(directory.join("app.db")).await
            }
            DatabaseConnection::Mysql(remote) => {
                let password = secrets.get(&remote.password_secret)?;
                RemoteOptions::mysql(remote, &password).connect().await
            }
            DatabaseConnection::Postgres(remote) => {
                let password = secrets.get(&remote.password_secret)?;
                RemoteOptions::postgres(remote, &password)?.connect().await
            }
        }
    }
}

// SQLx 的 ConnectOptions::Debug 会输出明文密码，封装后只暴露安全诊断。
enum RemoteOptions {
    Mysql(MySqlConnectOptions),
    Postgres(PgConnectOptions),
}

impl fmt::Debug for RemoteOptions {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Mysql(options) => f
                .debug_struct("MySqlOptions")
                .field("tls", &options.get_ssl_mode())
                .finish_non_exhaustive(),
            Self::Postgres(options) => f
                .debug_struct("PostgresOptions")
                .field("tls", &options.get_ssl_mode())
                .finish_non_exhaustive(),
        }
    }
}

impl RemoteOptions {
    async fn connect(self) -> Result<Db, AppError> {
        match self {
            Self::Mysql(options) => Db::open_mysql(options).await,
            Self::Postgres(options) => Db::open_postgres(options).await,
        }
    }

    fn mysql(config: &RemoteDatabaseConfig, password: &SecretString) -> Self {
        let mut options = MySqlConnectOptions::new()
            .host(&config.host)
            .port(config.port.get())
            .database(&config.name)
            .username(&config.username)
            .password(password.expose_secret())
            .ssl_mode(match config.tls {
                TlsMode::Disabled => MySqlSslMode::Disabled,
                TlsMode::VerifyCa => MySqlSslMode::VerifyCa,
                TlsMode::VerifyFull => MySqlSslMode::VerifyIdentity,
            });
        if let Some(path) = &config.tls_ca_file {
            options = options.ssl_ca(path);
        }
        Self::Mysql(options)
    }

    fn postgres(config: &RemoteDatabaseConfig, password: &SecretString) -> Result<Self, AppError> {
        // SQLx 会隐式读取这两项；本产品未提供客户端证书认证，不能引入第三个秘密来源。
        for name in ["PGSSLCERT", "PGSSLKEY"] {
            if std::env::var_os(name).is_some() {
                return Err(AppError::new(INPUT_INVALID).with_param("path", name));
            }
        }
        // 不读取用户目录中的 pgpass；密码显式覆盖 PGPASSWORD。
        let mut options = PgConnectOptions::new_without_pgpass()
            .host(&config.host)
            .port(config.port.get())
            .database(&config.name)
            .username(&config.username)
            .password(password.expose_secret())
            .ssl_mode(match config.tls {
                TlsMode::Disabled => PgSslMode::Disable,
                TlsMode::VerifyCa => PgSslMode::VerifyCa,
                TlsMode::VerifyFull => PgSslMode::VerifyFull,
            });
        options = match &config.tls_ca_file {
            Some(path) => options.ssl_root_cert(path),
            // 空的附加 CA 列表仍使用系统根，避免继承 PGSSLROOTCERT。
            None => options.ssl_root_cert_from_pem(Vec::new()),
        };
        Ok(Self::Postgres(options))
    }
}

pub(super) fn connection_error(error: sqlx::Error) -> AppError {
    let tls = matches!(&error, sqlx::Error::Tls(_))
        || matches!(&error, sqlx::Error::Io(error) if error.kind() == std::io::ErrorKind::InvalidData);
    // 服务端错误与驱动错误可能包含连接数据；不将原始消息写入日志或 IPC。
    if tls {
        AppError::new(TLS_FAILED).with_source(std::io::Error::other(
            "数据库 TLS 握手失败，请核对服务端 TLS、CA、证书有效期与证书主机名",
        ))
    } else {
        AppError::new(CONNECTION_FAILED).with_source(std::io::Error::other(
            "数据库连接失败，请核对主机、端口、库名、用户名与 SecretStore 密码",
        ))
    }
}

#[cfg(test)]
mod tests;
