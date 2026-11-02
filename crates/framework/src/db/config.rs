use std::{
    num::{NonZeroU16, NonZeroUsize},
    path::PathBuf,
};

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::network::TlsMode;

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq, TS)]
#[serde(rename_all = "lowercase")]
pub enum DatabaseKind {
    Sqlite,
    Mysql,
    Postgres,
}

#[derive(Clone, Debug)]
pub struct RemoteDatabaseConfig {
    pub host: String,
    pub port: NonZeroU16,
    pub name: String,
    pub username: String,
    pub password_secret: String,
    pub tls: TlsMode,
    pub tls_ca_file: Option<PathBuf>,
}

#[derive(Clone, Debug)]
pub enum DatabaseConnection {
    Sqlite,
    Mysql(RemoteDatabaseConfig),
    Postgres(RemoteDatabaseConfig),
}

#[derive(Clone, Debug)]
pub struct DatabaseConfig {
    pub connection: DatabaseConnection,
    pub backup_keep: NonZeroUsize,
}

impl DatabaseConfig {
    pub fn kind(&self) -> DatabaseKind {
        match self.connection {
            DatabaseConnection::Sqlite => DatabaseKind::Sqlite,
            DatabaseConnection::Mysql(_) => DatabaseKind::Mysql,
            DatabaseConnection::Postgres(_) => DatabaseKind::Postgres,
        }
    }
}
