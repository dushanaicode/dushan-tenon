use sea_query::{Asterisk, Expr, ExprTrait, LikeExpr, Order, Query, SelectStatement};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::{Db, FromDbRow, internal};
use crate::error::{AppError, INPUT_INVALID};

#[derive(Clone, Copy, Debug, Deserialize, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct PageRequest {
    pub page: u32,
    pub page_size: u32,
}

impl PageRequest {
    pub fn validate(self) -> Result<(), AppError> {
        if self.page == 0 {
            return Err(AppError::new(INPUT_INVALID).with_param("path", "page"));
        }
        if !(1..=100).contains(&self.page_size) {
            return Err(AppError::new(INPUT_INVALID).with_param("path", "pageSize"));
        }
        Ok(())
    }
}

#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct Page<T> {
    pub items: Vec<T>,
    #[ts(type = "number")]
    pub total: i64,
    pub page: u32,
    pub page_size: u32,
}

/// 字面包含匹配；显式使用 !，避免三库默认反斜线转义规则不同。
pub fn contains_literal(keyword: &str) -> LikeExpr {
    let escaped = keyword
        .replace('!', "!!")
        .replace('%', "!%")
        .replace('_', "!_");
    LikeExpr::new(format!("%{escaped}%")).escape('!')
}

impl Db {
    /// 查询的 LIMIT/OFFSET 与排序由本方法设置。排序须包含唯一的决胜列（如 id）。
    pub async fn fetch_page<T: FromDbRow>(
        &self,
        query: &SelectStatement,
        request: PageRequest,
        order: &[(&str, Order)],
    ) -> Result<Page<T>, AppError> {
        request.validate()?;
        if order.is_empty() {
            return Err(internal(std::io::Error::other(
                "pagination requires a stable order",
            )));
        }
        let mut query = query.clone();
        query.clear_order_by().reset_limit().reset_offset();
        let count = Query::select()
            .expr(Expr::col(Asterisk).count())
            .from_subquery(query.clone(), "page_rows")
            .to_owned();
        let (total,): (i64,) = self.fetch_one(&count).await?;
        for (column, direction) in order {
            query.order_by(sea_query::Alias::new(*column), direction.clone());
        }
        Ok(Page {
            items: self.fetch_rows(&query, Some(request)).await?,
            total,
            page: request.page,
            page_size: request.page_size,
        })
    }
}
