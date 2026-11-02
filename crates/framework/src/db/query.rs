use sea_query::{
    Alias, Asterisk, Expr, ExprTrait, InsertStatement, IntoCondition, Query, SelectStatement,
    UpdateStatement, Value,
};

use super::{ContractError, Db, Table, Tx, internal, table::*};
use crate::{
    actor::ExecutionContext,
    error::{AppError, DATA_NOT_FOUND, DATA_VERSION_CONFLICT},
    id::Id,
    time::Timestamp,
};

/// 先选择读取范围，再用 `into_query()` 取得可继续组合的 sea-query 语句。
pub fn select(table: Table) -> Select {
    Select { table }
}

pub struct Select {
    table: Table,
}

impl Select {
    pub fn into_query(self) -> SelectStatement {
        let mut query = Query::select();
        query
            .column((self.table.name, Asterisk))
            .from(self.table.name);
        if self.table.soft_delete {
            query.and_where(Expr::col((self.table.name, DELETED_AT)).is_null());
        }
        query
    }
}

fn business_values<'a>(
    values: impl IntoIterator<Item = (&'a str, Value)>,
) -> Result<Vec<(&'a str, Value)>, AppError> {
    values
        .into_iter()
        .map(|(column, value)| {
            // SQLite 标识符不区分 ASCII 大小写，保留列校验采用相同规则。
            if RESERVED_COLUMNS
                .iter()
                .any(|reserved| column.eq_ignore_ascii_case(reserved))
            {
                return Err(internal(ContractError::ReservedColumn(column.to_owned())));
            }
            Ok((column, value))
        })
        .collect()
}

fn insert_statement<'a>(
    table: Table,
    context: &ExecutionContext,
    values: impl IntoIterator<Item = (&'a str, Value)>,
) -> Result<(Id, InsertStatement), AppError> {
    let mut values = business_values(values)?;
    let id = Id::new();
    values.push((ID, id.into()));
    if table.audit {
        let now = Timestamp::now();
        let actor = context.actor.audit_value();
        values.extend([
            (CREATED_AT, now.into()),
            (CREATED_BY, actor.clone().into()),
            (UPDATED_AT, now.into()),
            (UPDATED_BY, actor.into()),
        ]);
    }
    if table.soft_delete {
        values.extend([(DELETED_AT, Value::BigInt(None)), (DELETE_TOKEN, "".into())]);
    }
    if table.optimistic_lock {
        values.push((ROW_VERSION, 1_i64.into()));
    }
    let (columns, values): (Vec<_>, Vec<_>) = values.into_iter().unzip();
    let mut query = Query::insert();
    query
        .into_table(table.name)
        .columns(columns.into_iter().map(Alias::new))
        .values(values.into_iter().map(Expr::val))
        .map_err(internal)?;
    Ok((id, query))
}

fn update_statement<'a>(
    table: Table,
    context: &ExecutionContext,
    id: Id,
    expected_version: Option<i64>,
    values: impl IntoIterator<Item = (&'a str, Value)>,
) -> Result<UpdateStatement, AppError> {
    let values = business_values(values)?;
    if table.optimistic_lock != expected_version.is_some() {
        return Err(internal(ContractError::VersionRequired));
    }
    let mut query = Query::update();
    query
        .table(table.name)
        .values(
            values
                .into_iter()
                .map(|(column, value)| (Alias::new(column), Expr::val(value))),
        )
        .and_where(Expr::col(ID).eq(id));
    if table.audit {
        query
            .value(UPDATED_AT, Timestamp::now())
            .value(UPDATED_BY, context.actor.audit_value());
    }
    if table.soft_delete {
        query.and_where(Expr::col(DELETED_AT).is_null());
    }
    if let Some(version) = expected_version {
        query
            .value(ROW_VERSION, Expr::col(ROW_VERSION).add(1_i64))
            .and_where(Expr::col(ROW_VERSION).eq(version));
    }
    Ok(query)
}

impl Db {
    pub async fn insert<'a>(
        &self,
        table: Table,
        context: &ExecutionContext,
        values: impl IntoIterator<Item = (&'a str, Value)>,
    ) -> Result<Id, AppError> {
        let (id, query) = insert_statement(table, context, values)?;
        self.execute(&query).await?;
        Ok(id)
    }

    /// 启用乐观锁的表须传 `Some(version)`，其余表传 `None`。
    pub async fn update_by_id<'a>(
        &self,
        table: Table,
        context: &ExecutionContext,
        id: Id,
        expected_version: Option<i64>,
        values: impl IntoIterator<Item = (&'a str, Value)>,
    ) -> Result<(), AppError> {
        let mut tx = self.begin().await?;
        tx.update_by_id(table, context, id, expected_version, values)
            .await?;
        tx.commit().await
    }

    pub async fn soft_delete_by_id(
        &self,
        table: Table,
        context: &ExecutionContext,
        id: Id,
        expected_version: Option<i64>,
    ) -> Result<(), AppError> {
        let mut tx = self.begin().await?;
        tx.soft_delete_by_id(table, context, id, expected_version)
            .await?;
        tx.commit().await
    }
}

impl Tx<'_> {
    pub async fn delete_by_id(&mut self, table: Table, id: Id) -> Result<(), AppError> {
        if self.delete_where(table, Expr::col(ID).eq(id)).await? == 0 {
            return Err(AppError::new(DATA_NOT_FOUND));
        }
        Ok(())
    }

    /// 物理删除只用于未启用软删除的表，条件必须由仓储显式提供。
    pub async fn delete_where(
        &mut self,
        table: Table,
        condition: impl IntoCondition,
    ) -> Result<u64, AppError> {
        if table.soft_delete {
            return Err(internal(ContractError::PhysicalDeleteDisabled));
        }
        self.execute(
            &Query::delete()
                .from_table(table.name)
                .cond_where(condition)
                .to_owned(),
        )
        .await
    }

    pub async fn insert<'a>(
        &mut self,
        table: Table,
        context: &ExecutionContext,
        values: impl IntoIterator<Item = (&'a str, Value)>,
    ) -> Result<Id, AppError> {
        let (id, query) = insert_statement(table, context, values)?;
        self.execute(&query).await?;
        Ok(id)
    }

    pub async fn update_by_id<'a>(
        &mut self,
        table: Table,
        context: &ExecutionContext,
        id: Id,
        expected_version: Option<i64>,
        values: impl IntoIterator<Item = (&'a str, Value)>,
    ) -> Result<(), AppError> {
        let query = update_statement(table, context, id, expected_version, values)?;
        self.execute_update(table, id, &query).await
    }

    pub async fn soft_delete_by_id(
        &mut self,
        table: Table,
        context: &ExecutionContext,
        id: Id,
        expected_version: Option<i64>,
    ) -> Result<(), AppError> {
        if !table.soft_delete {
            return Err(internal(ContractError::SoftDeleteDisabled));
        }
        let mut query = update_statement(table, context, id, expected_version, [])?;
        query
            .value(DELETED_AT, Timestamp::now())
            .value(DELETE_TOKEN, id);
        self.execute_update(table, id, &query).await
    }

    async fn execute_update(
        &mut self,
        table: Table,
        id: Id,
        query: &UpdateStatement,
    ) -> Result<(), AppError> {
        if self.execute(query).await? != 0 {
            return Ok(());
        }
        // MySQL REPEATABLE READ 下用锁定读查看当前行，不能复用事务较早的读快照。
        // SQLite 的构建器不生成 FOR UPDATE，BEGIN IMMEDIATE 已持有写锁。
        let mut query = select(table).into_query();
        query
            .clear_selects()
            .column(ID)
            .and_where(Expr::col(ID).eq(id))
            .lock_exclusive();
        let existing: Option<(Id,)> = self.fetch_optional(&query).await?;
        Err(AppError::new(if existing.is_some() {
            DATA_VERSION_CONFLICT
        } else {
            DATA_NOT_FOUND
        }))
    }
}
