use std::{collections::BTreeMap, error::Error, sync::Arc, time::Duration};

use sea_query::{Expr, ExprTrait, SelectStatement, Value};
use secrecy::{ExposeSecret, SecretString};

use super::{ParamDeclaration, ParamEntry, ParamKind, ParamSource};
use crate::{
    actor::ExecutionContext,
    cache::Cache,
    db::{Db, Table, Tx, select},
    error::{AppError, DATA_VERSION_CONFLICT, INPUT_INVALID, INTERNAL_UNEXPECTED},
    id::Id,
    secret::{CredentialBackend, SECRET_NOT_FOUND, SecretStore},
    time::Timestamp,
};

const NS: &str = "framework.param";
const TTL: Duration = Duration::from_secs(60);
const TABLE: Table = Table {
    name: "fw_param",
    audit: true,
    soft_delete: false,
    optimistic_lock: true,
};

#[derive(sqlx::FromRow)]
struct Record {
    id: Id,
    param_key: String,
    value: Option<String>,
    secret_set: bool,
    row_version: i64,
    updated_at: Timestamp,
}

fn query() -> SelectStatement {
    select(TABLE)
        .into_query()
        .clear_selects()
        .columns([
            "id",
            "param_key",
            "value",
            "secret_set",
            "row_version",
            "updated_at",
        ])
        .to_owned()
}

#[derive(Clone)]
pub struct ParamStore(Arc<Inner>);

struct Inner {
    db: Db,
    cache: Cache,
    secrets: SecretStore<Box<dyn CredentialBackend + Send + Sync>>,
    declarations: BTreeMap<&'static str, (String, ParamDeclaration)>,
}

impl ParamStore {
    /// 每组为模块 ID、该模块声明的权限及参数；全部校验后才能构造存储。
    pub fn new<B: CredentialBackend + Send + Sync + 'static>(
        db: Db,
        cache: Cache,
        secrets: SecretStore<B>,
        declarations: &[(&str, &[&str], &[ParamDeclaration])],
    ) -> Result<Self, AppError> {
        let mut registered = BTreeMap::new();
        for &(module, permissions, declarations) in declarations {
            if !module.starts_with(|c: char| c.is_ascii_lowercase())
                || !module
                    .bytes()
                    .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit())
            {
                return Err(internal());
            }
            for &declaration in declarations {
                if !declaration.valid(module, permissions)
                    || registered
                        .insert(declaration.key, (module.to_owned(), declaration))
                        .is_some()
                {
                    return Err(internal());
                }
            }
        }
        Ok(Self(Arc::new(Inner {
            db,
            cache,
            secrets: secrets.boxed(),
            declarations: registered,
        })))
    }

    pub fn declarations(&self) -> impl Iterator<Item = &ParamDeclaration> {
        self.0
            .declarations
            .values()
            .map(|(_, declaration)| declaration)
    }

    fn declaration(&self, key: &str) -> Result<ParamDeclaration, AppError> {
        self.0
            .declarations
            .get(key)
            .map(|(_, declaration)| *declaration)
            .ok_or_else(internal)
    }

    async fn value(
        &self,
        declaration: ParamDeclaration,
        tx: Option<&mut Tx<'_>>,
    ) -> Result<String, AppError> {
        let key = declaration.key;
        if let Some(value) = self.0.cache.get_json::<String>(NS, key).await? {
            return checked(declaration, value);
        }
        let query = query().and_where(Expr::col("param_key").eq(key)).to_owned();
        let row: Option<Record> = match tx {
            Some(tx) => tx.fetch_optional(&query).await?,
            None => self.0.db.fetch_optional(&query).await?,
        };
        let value = effective(declaration, row.as_ref())?;
        self.0.cache.set_json(NS, key, &value, TTL).await?;
        Ok(value)
    }

    pub async fn text(&self, key: &str) -> Result<String, AppError> {
        let d = self.declaration(key)?;
        if !matches!(d.kind, ParamKind::Text { .. }) {
            return Err(internal());
        }
        self.value(d, None).await
    }

    pub async fn int(&self, key: &str) -> Result<i64, AppError> {
        let d = self.declaration(key)?;
        if !matches!(d.kind, ParamKind::Integer { .. }) {
            return Err(internal());
        }
        self.value(d, None).await?.parse().map_err(|_| internal())
    }

    /// 已持有写事务的业务复用当前连接，避免占满连接池后再申请读取连接。
    pub async fn int_in(&self, tx: &mut Tx<'_>, key: &str) -> Result<i64, AppError> {
        let d = self.declaration(key)?;
        if !matches!(d.kind, ParamKind::Integer { .. }) {
            return Err(internal());
        }
        self.value(d, Some(tx))
            .await?
            .parse()
            .map_err(|_| internal())
    }

    pub async fn bool(&self, key: &str) -> Result<bool, AppError> {
        let d = self.declaration(key)?;
        if d.kind != ParamKind::Boolean {
            return Err(internal());
        }
        Ok(self.value(d, None).await? == "true")
    }

    /// 已持有写事务的业务复用当前连接。
    pub async fn bool_in(&self, tx: &mut Tx<'_>, key: &str) -> Result<bool, AppError> {
        let d = self.declaration(key)?;
        if d.kind != ParamKind::Boolean {
            return Err(internal());
        }
        Ok(self.value(d, Some(tx)).await? == "true")
    }

    pub async fn choice(&self, key: &str) -> Result<String, AppError> {
        let d = self.declaration(key)?;
        if !matches!(d.kind, ParamKind::Choice { .. }) {
            return Err(internal());
        }
        self.value(d, None).await
    }

    pub async fn secret(&self, key: &str) -> Result<Option<SecretString>, AppError> {
        let d = self.declaration(key)?;
        if d.kind != ParamKind::Secret {
            return Err(internal());
        }
        let row: Option<Record> = self
            .0
            .db
            .fetch_optional(&query().and_where(Expr::col("param_key").eq(key)).to_owned())
            .await?;
        if row.is_none_or(|r| !r.secret_set) {
            return Ok(None);
        }
        let value = self.0.secrets.get(&format!("param.{key}"))?;
        if !d.kind.valid_value(value.expose_secret()) {
            return Err(internal());
        }
        Ok(Some(value))
    }

    pub async fn set(
        &self,
        actor: &ExecutionContext,
        key: &str,
        value: &str,
        row_version: Option<i64>,
    ) -> Result<(), AppError> {
        let declaration = self.declaration(key)?;
        if !declaration.kind.valid_value(value) {
            return Err(AppError::new(INPUT_INVALID).with_param("path", "value"));
        }
        let mut tx = self.0.db.begin().await?;
        let row = locked(&mut tx, key).await?;
        if row.as_ref().map(|r| r.row_version) != row_version {
            return Err(AppError::new(DATA_VERSION_CONFLICT));
        }
        let secret = declaration.kind == ParamKind::Secret;
        let fields = [
            (
                "value",
                if secret {
                    Value::String(None)
                } else {
                    value.into()
                },
            ),
            ("secret_set", secret.into()),
        ];
        // 先取得/创建 SQL 行，串行化首次设置；凭据先于 SQL 提交生效，提交失败补偿。
        if let Some(row) = row {
            tx.update_by_id(TABLE, actor, row.id, row_version, fields)
                .await?;
        } else {
            tx.insert(
                TABLE,
                actor,
                fields.into_iter().chain([("param_key", key.into())]),
            )
            .await
            .map_err(write_error)?;
        }
        let change = if secret {
            Some(SecretChange::apply(
                &self.0.secrets,
                key,
                Some(&SecretString::from(value)),
            )?)
        } else {
            None
        };
        complete(tx.commit().await, change)?;
        self.0.cache.delete(NS, key).await
    }

    pub async fn reset(&self, key: &str, row_version: Option<i64>) -> Result<(), AppError> {
        let declaration = self.declaration(key)?;
        let mut tx = self.0.db.begin().await?;
        let row = locked(&mut tx, key).await?;
        if row.as_ref().map(|r| r.row_version) != row_version {
            return Err(AppError::new(DATA_VERSION_CONFLICT));
        }
        if let Some(row) = row {
            tx.delete_by_id(TABLE, row.id).await?;
            let change = if declaration.kind == ParamKind::Secret {
                Some(SecretChange::apply(&self.0.secrets, key, None)?)
            } else {
                None
            };
            complete(tx.commit().await, change)?;
        } else {
            tx.rollback().await?;
        }
        self.0.cache.delete(NS, key).await
    }

    pub async fn entries(&self) -> Result<Vec<ParamEntry>, AppError> {
        let rows: Vec<Record> = self.0.db.fetch_all(&query()).await?;
        let rows: BTreeMap<_, _> = rows.into_iter().map(|r| (r.param_key.clone(), r)).collect();
        self.0
            .declarations
            .values()
            .map(|(module_id, d)| {
                let row = rows.get(d.key);
                let secret = d.kind == ParamKind::Secret;
                let secret_set = secret && row.is_some_and(|r| r.secret_set);
                let database = if secret {
                    secret_set
                } else {
                    row.is_some_and(|r| r.value.is_some())
                };
                let value = if secret {
                    None
                } else {
                    Some(effective(*d, row)?)
                };
                Ok(ParamEntry {
                    key: d.key.into(),
                    module_id: module_id.clone(),
                    kind: d.kind,
                    is_default: if secret {
                        !secret_set
                    } else {
                        value.as_deref() == Some(d.default)
                    },
                    value,
                    default: (!secret).then(|| d.default.into()),
                    secret_set,
                    row_version: row.map(|r| r.row_version),
                    updated_at: row.map(|r| r.updated_at),
                    group: d.group.into(),
                    order: d.order,
                    read_permission: d.read_permission.map(str::to_owned),
                    write_permission: d.write_permission.map(str::to_owned),
                    effect: d.effect,
                    source: if database {
                        ParamSource::Database
                    } else {
                        ParamSource::Default
                    },
                })
            })
            .collect()
    }
}

async fn locked(tx: &mut Tx<'_>, key: &str) -> Result<Option<Record>, AppError> {
    let mut query = query().and_where(Expr::col("param_key").eq(key)).to_owned();
    // MySQL 不对不存在的键持有间隙锁；首次写入由唯一约束仲裁。
    let existing: Option<Record> = tx.fetch_optional(&query).await?;
    if existing.is_none() {
        return Ok(None);
    }
    tx.fetch_optional(query.lock_exclusive()).await
}

fn effective(d: ParamDeclaration, row: Option<&Record>) -> Result<String, AppError> {
    checked(
        d,
        row.and_then(|r| r.value.clone())
            .unwrap_or_else(|| d.default.into()),
    )
}
fn checked(d: ParamDeclaration, value: String) -> Result<String, AppError> {
    if d.kind.valid_value(&value) {
        Ok(value)
    } else {
        Err(internal())
    }
}
fn internal() -> AppError {
    AppError::new(INTERNAL_UNEXPECTED)
}

fn write_error(error: AppError) -> AppError {
    if error
        .source()
        .and_then(|e| e.downcast_ref::<sqlx::Error>())
        .and_then(sqlx::Error::as_database_error)
        .is_some_and(|e| e.is_unique_violation())
    {
        AppError::new(DATA_VERSION_CONFLICT)
    } else {
        error
    }
}

struct SecretChange<'a> {
    store: &'a SecretStore<Box<dyn CredentialBackend + Send + Sync>>,
    key: String,
    old: Option<SecretString>,
}
impl<'a> SecretChange<'a> {
    fn apply(
        store: &'a SecretStore<Box<dyn CredentialBackend + Send + Sync>>,
        key: &str,
        value: Option<&SecretString>,
    ) -> Result<Self, AppError> {
        let key = format!("param.{key}");
        let old = match store.get_stored(&key) {
            Ok(value) => Some(value),
            Err(error) if error.code() == SECRET_NOT_FOUND => None,
            Err(error) => return Err(error),
        };
        match value {
            Some(value) => store.set(&key, value)?,
            None if old.is_some() => store.delete(&key)?,
            None => {}
        }
        Ok(Self { store, key, old })
    }

    fn restore(self) -> Result<(), AppError> {
        match self.old {
            Some(value) => self.store.set(&self.key, &value),
            None => match self.store.delete(&self.key) {
                Err(error) if error.code() == SECRET_NOT_FOUND => Ok(()),
                result => result,
            },
        }
    }
}

fn complete(
    result: Result<(), AppError>,
    change: Option<SecretChange<'_>>,
) -> Result<(), AppError> {
    match result {
        Ok(()) => Ok(()),
        Err(error) => {
            if let Some(change) = change {
                change.restore()?;
            }
            Err(error)
        }
    }
}

#[cfg(test)]
mod tests;
