use sea_query::{Asterisk, Cond, Expr, ExprTrait, Query, SelectStatement};
use tenon_framework::{
    actor::ExecutionContext,
    db::Tx,
    error::{AppError, DATA_VERSION_CONFLICT, INTERNAL_UNEXPECTED},
    id::Id,
    time::Timestamp,
};

use crate::{
    DRAFT_EXPIRED, DRAFT_LIMIT, DemoDraftFields, DemoDraftLease, DemoDraftOpen, DemoDraftSaved,
    DemoDraftWrite, DemoSample, DemoSampleCreate, DemoSampleDraft, DemoSampleUpdate, DemoService,
    invalid, safe_error, samples,
};

const TABLE: &str = "demo_sample_draft";
const MAX_DRAFTS: i64 = 32;
const RETAIN_MS: i64 = 30 * 24 * 60 * 60 * 1000;

#[derive(sqlx::FromRow)]
struct DraftRow {
    id: Id,
    sample_id: Option<Id>,
    base_version: Option<i64>,
    session_id: Id,
    revision: i64,
    code: String,
    title: String,
    note: String,
    has_changes: bool,
    updated_at: Timestamp,
}

fn query(owner: Id) -> SelectStatement {
    Query::select()
        .columns([
            "id",
            "sample_id",
            "base_version",
            "session_id",
            "revision",
            "code",
            "title",
            "note",
            "has_changes",
            "updated_at",
        ])
        .from(TABLE)
        .and_where(Expr::col("created_by").eq(owner))
        .to_owned()
}

fn validate_fields(fields: &DemoDraftFields) -> Result<(), AppError> {
    if fields.code.len() > 32
        || !fields.code.is_ascii()
        || fields.code.chars().any(char::is_control)
    {
        return Err(invalid("code"));
    }
    if fields.title.chars().count() > 120 || fields.title.contains('\0') {
        return Err(invalid("title"));
    }
    if fields.note.chars().count() > 4096 || fields.note.contains('\0') {
        return Err(invalid("note"));
    }
    Ok(())
}

async fn current(
    tx: &mut Tx<'_>,
    owner: Id,
    sample: Option<Id>,
) -> Result<(Option<i64>, DemoDraftFields), AppError> {
    Ok(match sample {
        Some(id) => {
            let row = samples::locked(tx, owner, id).await?;
            (
                Some(row.row_version),
                DemoDraftFields {
                    code: row.code,
                    title: row.title,
                    note: row.note,
                },
            )
        }
        None => (
            None,
            DemoDraftFields {
                code: String::new(),
                title: String::new(),
                note: String::new(),
            },
        ),
    })
}

async fn leased(tx: &mut Tx<'_>, owner: Id, lease: &DemoDraftLease) -> Result<DraftRow, AppError> {
    let row: DraftRow = tx
        .fetch_optional(
            &query(owner)
                .and_where(Expr::col("id").eq(lease.id))
                .lock_exclusive()
                .to_owned(),
        )
        .await
        .map_err(safe_error)?
        .ok_or_else(|| AppError::new(DRAFT_EXPIRED))?;
    if row.session_id != lease.session_id
        || row.updated_at.as_millis() <= Timestamp::now().as_millis() - RETAIN_MS
    {
        return Err(AppError::new(DRAFT_EXPIRED));
    }
    if row.revision != lease.revision {
        return Err(AppError::new(DATA_VERSION_CONFLICT));
    }
    Ok(row)
}

async fn remove(tx: &mut Tx<'_>, owner: Id, id: Id) -> Result<(), AppError> {
    tx.execute(
        &Query::delete()
            .from_table(TABLE)
            .and_where(Expr::col("created_by").eq(owner))
            .and_where(Expr::col("id").eq(id))
            .to_owned(),
    )
    .await
    .map_err(safe_error)?;
    Ok(())
}

pub(crate) async fn remove_sample(tx: &mut Tx<'_>, owner: Id, sample: Id) -> Result<(), AppError> {
    tx.execute(
        &Query::delete()
            .from_table(TABLE)
            .and_where(Expr::col("created_by").eq(owner))
            .and_where(Expr::col("sample_id").eq(sample))
            .to_owned(),
    )
    .await
    .map_err(safe_error)?;
    Ok(())
}

impl DemoService {
    pub async fn draft_open(
        &self,
        context: &ExecutionContext,
        input: DemoDraftOpen,
    ) -> Result<DemoSampleDraft, AppError> {
        let (owner, _) = self.enter(context)?;
        let mut tx = self.started()?.db.begin().await.map_err(safe_error)?;
        self.account
            .lock_owner_in_tx(&mut tx)
            .await
            .map_err(safe_error)?;
        let (current_version, baseline) = current(&mut tx, owner, input.sample_id).await?;
        let now = Timestamp::now();
        tx.execute(
            &Query::delete()
                .from_table(TABLE)
                .and_where(Expr::col("created_by").eq(owner))
                .cond_where(
                    Cond::any()
                        .add(Expr::col("updated_at").lte(now.as_millis() - RETAIN_MS))
                        // Only one sample editor is open in the main window. Empty closed
                        // sessions are not recovery data and must not consume the budget.
                        .add(Expr::col("has_changes").eq(false)),
                )
                .to_owned(),
        )
        .await
        .map_err(safe_error)?;
        let target = input
            .sample_id
            .map_or_else(|| "new".into(), |id| id.to_string());
        let existing: Option<DraftRow> = tx
            .fetch_optional(
                &query(owner)
                    .and_where(Expr::col("target_key").eq(target.clone()))
                    .lock_exclusive()
                    .to_owned(),
            )
            .await
            .map_err(safe_error)?;
        let (id, base_version, fields, recovered) = if let Some(row) = existing {
            if row.has_changes {
                (
                    row.id,
                    row.base_version,
                    DemoDraftFields {
                        code: row.code,
                        title: row.title,
                        note: row.note,
                    },
                    true,
                )
            } else {
                (row.id, current_version, baseline.clone(), false)
            }
        } else {
            let (count,): (i64,) = tx
                .fetch_optional(
                    &Query::select()
                        .expr(Expr::col(Asterisk).count())
                        .from(TABLE)
                        .and_where(Expr::col("created_by").eq(owner))
                        .to_owned(),
                )
                .await
                .map_err(safe_error)?
                .ok_or_else(|| AppError::new(INTERNAL_UNEXPECTED))?;
            if count >= MAX_DRAFTS {
                return Err(AppError::new(DRAFT_LIMIT));
            }
            (Id::new(), current_version, baseline.clone(), false)
        };
        // A new editing session invalidates every outstanding writer from an earlier form.
        let session_id = Id::new();
        remove(&mut tx, owner, id).await?;
        tx.execute(
            &Query::insert()
                .into_table(TABLE)
                .columns([
                    "id",
                    "created_by",
                    "target_key",
                    "sample_id",
                    "base_version",
                    "session_id",
                    "revision",
                    "code",
                    "title",
                    "note",
                    "has_changes",
                    "updated_at",
                ])
                .values_panic([
                    id.into(),
                    owner.into(),
                    target.into(),
                    input.sample_id.map(|id| id.to_string()).into(),
                    base_version.into(),
                    session_id.into(),
                    0_i64.into(),
                    fields.code.clone().into(),
                    fields.title.clone().into(),
                    fields.note.clone().into(),
                    recovered.into(),
                    now.into(),
                ])
                .to_owned(),
        )
        .await
        .map_err(safe_error)?;
        tx.commit().await.map_err(safe_error)?;
        Ok(DemoSampleDraft {
            lease: DemoDraftLease {
                id,
                session_id,
                revision: 0,
            },
            sample_id: input.sample_id,
            base_version,
            baseline,
            fields,
            recovered,
            conflict: base_version != current_version,
            updated_at: now,
        })
    }

    pub async fn draft_write(
        &self,
        context: &ExecutionContext,
        input: DemoDraftWrite,
    ) -> Result<DemoDraftSaved, AppError> {
        let (owner, _) = self.enter(context)?;
        validate_fields(&input.fields)?;
        let mut tx = self.started()?.db.begin().await.map_err(safe_error)?;
        self.account
            .lock_owner_in_tx(&mut tx)
            .await
            .map_err(safe_error)?;
        let row = leased(&mut tx, owner, &input.lease).await?;
        let (version, baseline) = current(&mut tx, owner, row.sample_id).await?;
        if version != row.base_version {
            return Err(AppError::new(DATA_VERSION_CONFLICT));
        }
        if row.sample_id.is_some() && input.fields.code != baseline.code {
            return Err(invalid("code"));
        }
        if row.revision >= samples::MAX_VERSION {
            return Err(invalid("revision"));
        }
        let revision = row.revision + 1;
        let now = Timestamp::now();
        tx.execute(
            &Query::update()
                .table(TABLE)
                .values([
                    ("revision", revision.into()),
                    ("code", input.fields.code.clone().into()),
                    ("title", input.fields.title.clone().into()),
                    ("note", input.fields.note.clone().into()),
                    ("has_changes", (input.fields != baseline).into()),
                    ("updated_at", now.into()),
                ])
                .and_where(Expr::col("id").eq(row.id))
                .and_where(Expr::col("created_by").eq(owner))
                .to_owned(),
        )
        .await
        .map_err(safe_error)?;
        tx.commit().await.map_err(safe_error)?;
        Ok(DemoDraftSaved {
            revision,
            updated_at: now,
        })
    }

    pub async fn draft_discard(
        &self,
        context: &ExecutionContext,
        lease: DemoDraftLease,
    ) -> Result<(), AppError> {
        let (owner, _) = self.enter(context)?;
        let mut tx = self.started()?.db.begin().await.map_err(safe_error)?;
        self.account
            .lock_owner_in_tx(&mut tx)
            .await
            .map_err(safe_error)?;
        let row = leased(&mut tx, owner, &lease).await?;
        remove(&mut tx, owner, row.id).await?;
        tx.commit().await.map_err(safe_error)
    }

    pub async fn draft_commit(
        &self,
        context: &ExecutionContext,
        lease: DemoDraftLease,
    ) -> Result<DemoSample, AppError> {
        let (owner, _) = self.enter(context)?;
        let started = self.started()?;
        let mut tx = started.db.begin().await.map_err(safe_error)?;
        self.account
            .lock_owner_in_tx(&mut tx)
            .await
            .map_err(safe_error)?;
        let row = leased(&mut tx, owner, &lease).await?;
        let id = match (row.sample_id, row.base_version) {
            (Some(id), Some(row_version)) => {
                let input = DemoSampleUpdate {
                    id,
                    row_version,
                    title: row.title,
                    note: row.note,
                };
                samples::validate_fields(&input.title, &input.note)?;
                samples::update_in_tx(&mut tx, owner, input).await?;
                id
            }
            (None, None) => {
                let input = DemoSampleCreate {
                    code: row.code,
                    title: row.title,
                    note: row.note,
                };
                samples::validate_create(&input)?;
                samples::create_in_tx(&mut tx, owner, &input).await?
            }
            _ => return Err(AppError::new(crate::INTERNAL_UNEXPECTED)),
        };
        remove(&mut tx, owner, row.id).await?;
        tx.commit().await.map_err(safe_error)?;
        started
            .present(samples::get(&started.db, owner, id).await?)
            .await
    }
}
