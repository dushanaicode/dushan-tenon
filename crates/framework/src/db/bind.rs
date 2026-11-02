use std::{any::Any, collections::HashSet};

use sea_query::{MysqlQueryBuilder, QueryBuilder, QueryStatementBuilder, UpdateStatement, Value};
use sqlx::{Database, Encode, Type, query::Query};

use super::{ContractError, PageRequest, internal};
use crate::error::AppError;

pub(super) fn query<DB: Database>(
    statement: &(impl QueryStatementBuilder + Any),
    builder: &impl QueryBuilder,
    pagination: Option<PageRequest>,
) -> Result<Query<'static, DB, DB::Arguments>, AppError>
where
    Option<bool>: Encode<'static, DB> + Type<DB>,
    Option<i64>: Encode<'static, DB> + Type<DB>,
    Option<f64>: Encode<'static, DB> + Type<DB>,
    Option<String>: Encode<'static, DB> + Type<DB>,
    Option<Vec<u8>>: Encode<'static, DB> + Type<DB>,
{
    if let Some(update) = (statement as &dyn Any).downcast_ref::<UpdateStatement>() {
        let mut columns = HashSet::new();
        for (column, _) in update.get_values() {
            let column = column.to_string();
            // SQLite / MySQL 列名不区分 ASCII 大小写，统一采用这一跨库约束。
            if !columns.insert(column.to_ascii_lowercase()) {
                return Err(internal(ContractError::DuplicateUpdateColumn(column)));
            }
        }
    }
    // PostgreSQL 构建器会把 Enum 降为 String 并添加类型转换，届时绑定层已无法识别。
    // 先用保留 Value 类型的 MySQL 参数收集遍历检查；这里生成的 SQL 不执行。
    // ponytail: PostgreSQL 多一次 AST 构建；sea-query 提供独立参数访问器后可去掉。
    if DB::NAME == sqlx::Postgres::NAME
        && statement
            .build_any(&MysqlQueryBuilder)
            .1
            .0
            .iter()
            .any(|value| matches!(value, Value::Enum(_)))
    {
        return Err(internal(ContractError::UnsupportedValue("Enum")));
    }
    let (mut sql, mut values) = statement.build_any(builder);
    if let Some(page) = pagination {
        // sea-query 的 limit/offset 固定生成 u64；分页边界已验证，显式绑定 i64，
        // 不放宽业务值的 u64 禁用合同。占位符格式由同一个方言构建器提供。
        let (placeholder, numbered) = builder.placeholder();
        for (clause, value) in [
            (" LIMIT ", i64::from(page.page_size)),
            (
                " OFFSET ",
                i64::from(page.page - 1) * i64::from(page.page_size),
            ),
        ] {
            sql.push_str(clause);
            sql.push_str(placeholder);
            values.0.push(Value::BigInt(Some(value)));
            if numbered {
                sql.push_str(&values.0.len().to_string());
            }
        }
    }
    // SQL 结构来自 sea-query；业务数据全部通过下列参数绑定传递。
    let mut query = sqlx::query(sqlx::AssertSqlSafe(sql));
    for value in values.0 {
        query = match value {
            Value::Bool(value) => query.bind(value),
            Value::TinyInt(value) => query.bind(value.map(i64::from)),
            Value::SmallInt(value) => query.bind(value.map(i64::from)),
            Value::Int(value) => query.bind(value.map(i64::from)),
            Value::BigInt(value) => query.bind(value),
            Value::TinyUnsigned(value) => query.bind(value.map(i64::from)),
            Value::SmallUnsigned(value) => query.bind(value.map(i64::from)),
            Value::Unsigned(value) => query.bind(value.map(i64::from)),
            Value::Double(value) => query.bind(value),
            Value::String(value) => query.bind(value),
            Value::Bytes(value) => query.bind(value),
            Value::BigUnsigned(_) => return Err(internal(ContractError::UnsupportedValue("u64"))),
            Value::Float(_) => return Err(internal(ContractError::UnsupportedValue("f32"))),
            Value::Char(_) => return Err(internal(ContractError::UnsupportedValue("char"))),
            Value::Enum(_) => return Err(internal(ContractError::UnsupportedValue("Enum"))),
        };
    }
    Ok(query)
}
