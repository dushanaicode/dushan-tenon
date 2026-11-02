use sea_query::{Asterisk, Cond, Expr, ExprTrait, Order, Query, SelectStatement, UpdateStatement};
use tenon_framework::{
    actor::ExecutionContext,
    db::{Db, Page, PageRequest, Tx, contains_literal},
    error::{AppError, DATA_VERSION_CONFLICT, INTERNAL_UNEXPECTED},
    id::Id,
    time::Timestamp,
};

use crate::{
    CODE_CONFLICT, DemoListInput, DemoOverview, DemoSample, DemoSampleCreate, DemoSampleId,
    DemoSampleStage, DemoSampleUpdate, DemoSampleVersion, DemoService, DemoStarted,
    SAMPLE_NOT_FOUND, invalid, safe_error,
};

pub(crate) const TABLE: &str = "demo_sample";
pub(crate) const MAX_VERSION: i64 = 9_007_199_254_740_991;

#[derive(sqlx::FromRow)]
pub(crate) struct SampleRow {
    pub id: Id,
    pub code: String,
    pub title: String,
    pub note: String,
    #[sqlx(try_from = "String")]
    pub stage: DemoSampleStage,
    pub character_count: Option<i64>,
    pub attachment_id: Option<Id>,
    pub created_at: Timestamp,
    pub updated_at: Timestamp,
    pub row_version: i64,
}

pub(crate) fn query(owner: Id) -> SelectStatement {
    Query::select()
        .columns([
            "id",
            "code",
            "title",
            "note",
            "stage",
            "character_count",
            "attachment_id",
            "created_at",
            "updated_at",
            "row_version",
        ])
        .from(TABLE)
        .and_where(Expr::col("created_by").eq(owner))
        .to_owned()
}

pub(crate) fn filtered(
    owner: Id,
    keyword: Option<&str>,
    stage: Option<DemoSampleStage>,
) -> SelectStatement {
    let mut query = query(owner);
    if let Some(keyword) = keyword {
        query.cond_where(
            Cond::any()
                .add(Expr::col("code").like(contains_literal(keyword)))
                .add(Expr::col("title").like(contains_literal(keyword)))
                .add(Expr::col("note").like(contains_literal(keyword))),
        );
    }
    if let Some(stage) = stage {
        query.and_where(Expr::col("stage").eq(stage.as_str()));
    }
    query
}

pub(crate) fn validate_filter(keyword: Option<&str>) -> Result<(), AppError> {
    if keyword.is_some_and(|value| value.chars().count() > 120 || value.contains('\0')) {
        return Err(invalid("keyword"));
    }
    Ok(())
}

pub(crate) fn validate_fields(title: &str, note: &str) -> Result<(), AppError> {
    if !(1..=120).contains(&title.chars().count()) || title.contains('\0') {
        return Err(invalid("title"));
    }
    if note.chars().count() > 4096 || note.contains('\0') {
        return Err(invalid("note"));
    }
    Ok(())
}

pub(crate) fn validate_create(input: &DemoSampleCreate) -> Result<(), AppError> {
    if !(1..=32).contains(&input.code.len())
        || !input.code.is_ascii()
        || input.code.trim() != input.code
        || input.code.chars().any(char::is_control)
    {
        return Err(invalid("code"));
    }
    validate_fields(&input.title, &input.note)
}

pub(crate) fn validate_version(version: i64) -> Result<(), AppError> {
    if !(1..MAX_VERSION).contains(&version) {
        return Err(invalid("rowVersion"));
    }
    Ok(())
}

pub(crate) fn check_version(row: &SampleRow, version: i64) -> Result<(), AppError> {
    validate_version(version)?;
    if row.row_version != version {
        return Err(AppError::new(DATA_VERSION_CONFLICT));
    }
    Ok(())
}

pub(crate) async fn get(db: &Db, owner: Id, id: Id) -> Result<SampleRow, AppError> {
    db.fetch_optional(&query(owner).and_where(Expr::col("id").eq(id)).to_owned())
        .await
        .map_err(safe_error)?
        .ok_or_else(|| AppError::new(SAMPLE_NOT_FOUND))
}

pub(crate) async fn locked(tx: &mut Tx<'_>, owner: Id, id: Id) -> Result<SampleRow, AppError> {
    tx.fetch_optional(
        &query(owner)
            .and_where(Expr::col("id").eq(id))
            .lock_exclusive()
            .to_owned(),
    )
    .await
    .map_err(safe_error)?
    .ok_or_else(|| AppError::new(SAMPLE_NOT_FOUND))
}

pub(crate) fn update(owner: Id, id: Id, version: i64) -> UpdateStatement {
    Query::update()
        .table(TABLE)
        .value("updated_at", Timestamp::now())
        .value("row_version", version + 1)
        .and_where(Expr::col("created_by").eq(owner))
        .and_where(Expr::col("id").eq(id))
        .and_where(Expr::col("row_version").eq(version))
        .to_owned()
}

pub(crate) async fn write(tx: &mut Tx<'_>, query: UpdateStatement) -> Result<(), AppError> {
    if tx.execute(&query).await.map_err(safe_error)? != 1 {
        return Err(AppError::new(DATA_VERSION_CONFLICT));
    }
    Ok(())
}

pub(crate) async fn code_exists(tx: &mut Tx<'_>, owner: Id, code: &str) -> Result<bool, AppError> {
    let found: Option<(Id,)> = tx
        .fetch_optional(
            &Query::select()
                .column("id")
                .from(TABLE)
                .and_where(Expr::col("created_by").eq(owner))
                .and_where(Expr::col("code").eq(code))
                .lock_exclusive()
                .to_owned(),
        )
        .await
        .map_err(safe_error)?;
    Ok(found.is_some())
}

pub(crate) async fn insert(
    tx: &mut Tx<'_>,
    owner: Id,
    input: &DemoSampleCreate,
) -> Result<Id, AppError> {
    let id = Id::new();
    let now = Timestamp::now();
    tx.execute(
        &Query::insert()
            .into_table(TABLE)
            .columns([
                "id",
                "created_by",
                "created_at",
                "updated_at",
                "row_version",
                "code",
                "title",
                "note",
                "stage",
            ])
            .values_panic([
                id.into(),
                owner.into(),
                now.into(),
                now.into(),
                1_i64.into(),
                input.code.clone().into(),
                input.title.clone().into(),
                input.note.clone().into(),
                DemoSampleStage::Draft.as_str().into(),
            ])
            .to_owned(),
    )
    .await
    .map_err(safe_error)?;
    Ok(id)
}

pub(crate) async fn create_in_tx(
    tx: &mut Tx<'_>,
    owner: Id,
    input: &DemoSampleCreate,
) -> Result<Id, AppError> {
    if code_exists(tx, owner, &input.code).await? {
        return Err(AppError::new(CODE_CONFLICT));
    }
    insert(tx, owner, input).await
}

pub(crate) async fn update_in_tx(
    tx: &mut Tx<'_>,
    owner: Id,
    input: DemoSampleUpdate,
) -> Result<(), AppError> {
    let row = locked(tx, owner, input.id).await?;
    check_version(&row, input.row_version)?;
    let mut query = update(owner, input.id, input.row_version);
    query
        .value("title", input.title)
        .value("note", input.note.clone());
    if row.note != input.note {
        query
            .value("stage", DemoSampleStage::Draft.as_str())
            .value("character_count", Option::<i64>::None);
    }
    write(tx, query).await
}

impl DemoStarted {
    pub(crate) async fn present(&self, row: SampleRow) -> Result<DemoSample, AppError> {
        let attachment = match row.attachment_id {
            Some(id) => Some(self.attachment(id).await?),
            None => None,
        };
        Ok(DemoSample {
            id: row.id,
            code: row.code,
            title: row.title,
            note: row.note,
            stage: row.stage,
            character_count: row.character_count,
            attachment,
            created_at: row.created_at,
            updated_at: row.updated_at,
            row_version: row.row_version,
        })
    }
}

impl DemoService {
    pub async fn sample_list(
        &self,
        context: &ExecutionContext,
        input: DemoListInput,
    ) -> Result<Page<DemoSample>, AppError> {
        let (owner, _) = self.enter(context)?;
        validate_filter(input.keyword.as_deref())?;
        let request = PageRequest {
            page: input.page,
            page_size: input.page_size,
        };
        request.validate()?;
        let started = self.started()?;
        let page = started
            .db
            .fetch_page::<SampleRow>(
                &filtered(owner, input.keyword.as_deref(), input.stage),
                request,
                &[("created_at", Order::Desc), ("id", Order::Desc)],
            )
            .await
            .map_err(safe_error)?;
        let mut items = Vec::with_capacity(page.items.len());
        for row in page.items {
            items.push(started.present(row).await?);
        }
        Ok(Page {
            items,
            total: page.total,
            page: page.page,
            page_size: page.page_size,
        })
    }

    pub async fn overview_get(&self, context: &ExecutionContext) -> Result<DemoOverview, AppError> {
        let (owner, _) = self.enter(context)?;
        let page = self
            .sample_list(
                context,
                DemoListInput {
                    page: 1,
                    page_size: 5,
                    keyword: None,
                    stage: None,
                },
            )
            .await?;
        let (ready,): (i64,) = self
            .started()?
            .db
            .fetch_optional(
                &Query::select()
                    .expr(Expr::col(Asterisk).count())
                    .from(TABLE)
                    .and_where(Expr::col("created_by").eq(owner))
                    .and_where(Expr::col("stage").eq(DemoSampleStage::Ready.as_str()))
                    .to_owned(),
            )
            .await
            .map_err(safe_error)?
            .ok_or_else(|| AppError::new(INTERNAL_UNEXPECTED))?;
        Ok(DemoOverview {
            total: page.total,
            ready,
            recent: page.items,
        })
    }

    pub async fn sample_get(
        &self,
        context: &ExecutionContext,
        input: DemoSampleId,
    ) -> Result<DemoSample, AppError> {
        let (owner, _) = self.enter(context)?;
        let started = self.started()?;
        started
            .present(get(&started.db, owner, input.id).await?)
            .await
    }

    pub async fn sample_create(
        &self,
        context: &ExecutionContext,
        input: DemoSampleCreate,
    ) -> Result<DemoSample, AppError> {
        let (owner, _) = self.enter(context)?;
        validate_create(&input)?;
        let started = self.started()?;
        let mut tx = started.db.begin().await.map_err(safe_error)?;
        // 创建/导入通过唯一所有者行锁串行，避免三库唯一约束竞争产生不同结果。
        self.account
            .lock_owner_in_tx(&mut tx)
            .await
            .map_err(safe_error)?;
        let id = create_in_tx(&mut tx, owner, &input).await?;
        tx.commit().await.map_err(safe_error)?;
        started.present(get(&started.db, owner, id).await?).await
    }

    pub async fn sample_update(
        &self,
        context: &ExecutionContext,
        input: DemoSampleUpdate,
    ) -> Result<DemoSample, AppError> {
        let (owner, _) = self.enter(context)?;
        validate_fields(&input.title, &input.note)?;
        let started = self.started()?;
        let mut tx = started.db.begin().await.map_err(safe_error)?;
        let id = input.id;
        update_in_tx(&mut tx, owner, input).await?;
        tx.commit().await.map_err(safe_error)?;
        started.present(get(&started.db, owner, id).await?).await
    }

    pub async fn sample_delete(
        &self,
        context: &ExecutionContext,
        input: DemoSampleVersion,
    ) -> Result<(), AppError> {
        let (owner, _) = self.enter(context)?;
        let started = self.started()?;
        let mut tx = started.db.begin().await.map_err(safe_error)?;
        self.account
            .lock_owner_in_tx(&mut tx)
            .await
            .map_err(safe_error)?;
        let row = locked(&mut tx, owner, input.id).await?;
        check_version(&row, input.row_version)?;
        let affected = tx
            .execute(
                &Query::delete()
                    .from_table(TABLE)
                    .and_where(Expr::col("id").eq(input.id))
                    .and_where(Expr::col("created_by").eq(owner))
                    .and_where(Expr::col("row_version").eq(input.row_version))
                    .to_owned(),
            )
            .await
            .map_err(safe_error)?;
        if affected != 1 {
            return Err(AppError::new(DATA_VERSION_CONFLICT));
        }
        crate::drafts::remove_sample(&mut tx, owner, input.id).await?;
        tx.commit().await.map_err(safe_error)?;
        if let Some(id) = row.attachment_id {
            started.delete_attachment(id).await?;
        }
        Ok(())
    }
}
