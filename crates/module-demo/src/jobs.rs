use std::{
    collections::{BTreeMap, BTreeSet},
    sync::{Arc, OnceLock},
};

use serde_json::{Value, json};
use tenon_framework::{
    actor::ExecutionContext,
    error::{AppError, INTERNAL_UNEXPECTED, JOB_CANCELLED, PERMISSION_DENIED},
    job::{JobContext, JobFuture, JobHandler, JobQueue, JobSubmitted, PermissionLookup, SubmitJob},
};
use tenon_module_account::AccountService;

use crate::{
    DemoMeasureInput, DemoSampleStage, DemoService, DemoStarted, invalid, safe_error, samples, user,
};

pub(crate) const PERMISSIONS: &[&str] = &["demo.sample.run", "demo.sample.read"];

pub(crate) async fn require_permissions(
    account: &AccountService,
    execution: &ExecutionContext,
    permissions: &[&str],
) -> Result<(), AppError> {
    user(execution)?;
    for permission in permissions {
        if !account
            .has_permission(execution.actor, permission)
            .await
            .map_err(safe_error)?
        {
            return Err(AppError::new(PERMISSION_DENIED).with_param("permission", *permission));
        }
    }
    Ok(())
}

pub(crate) async fn submit(
    service: &DemoService,
    queue: &JobQueue,
    execution: &ExecutionContext,
    kind: &str,
    payload: Value,
) -> Result<JobSubmitted, AppError> {
    let job_id = queue
        .submit(
            &service.started()?.db,
            SubmitJob {
                kind: kind.into(),
                payload,
                priority: 0,
                run_after: None,
                submitted_by: Some(user(execution)?),
            },
        )
        .await
        .map_err(safe_error)?;
    Ok(JobSubmitted { job_id })
}

impl DemoService {
    pub async fn measure_start(
        &self,
        queue: &JobQueue,
        execution: &ExecutionContext,
        input: DemoMeasureInput,
    ) -> Result<JobSubmitted, AppError> {
        let (owner, _) = self.enter(execution)?;
        if !(1..=1000).contains(&input.samples.len()) {
            return Err(invalid("samples"));
        }
        let mut ids = BTreeSet::new();
        for sample in &input.samples {
            if !ids.insert(sample.id) {
                return Err(invalid("samples"));
            }
            let row = samples::get(&self.started()?.db, owner, sample.id).await?;
            samples::check_version(&row, sample.row_version)?;
        }
        submit(
            self,
            queue,
            execution,
            "demo.measure",
            serde_json::to_value(input).map_err(|_| AppError::new(INTERNAL_UNEXPECTED))?,
        )
        .await
    }
}

pub(crate) struct Measure {
    pub started: Arc<OnceLock<DemoStarted>>,
    pub account: Arc<AccountService>,
}

impl JobHandler for Measure {
    fn kind(&self) -> &'static str {
        "demo.measure"
    }
    fn permissions(&self) -> &'static [&'static str] {
        PERMISSIONS
    }
    fn retry_safe(&self) -> bool {
        false
    }
    fn max_attempts(&self) -> i32 {
        1
    }
    fn run(&self, context: JobContext) -> JobFuture<'_> {
        Box::pin(async move {
            let input: DemoMeasureInput = serde_json::from_value(context.payload.clone())
                .map_err(|_| AppError::new(INTERNAL_UNEXPECTED))?;
            let started = self
                .started
                .get()
                .ok_or_else(|| AppError::new(INTERNAL_UNEXPECTED))?;
            let owner = user(&context.execution)?;
            // NextJob：开始时读一次；关闭开发者模式不终止已提交任务。
            let batch_size = started
                .params
                .int("demo.batch_size")
                .await
                .map_err(safe_error)? as usize;
            let total = input.samples.len() as i64;
            let mut processed = 0_i64;
            for batch in input.samples.chunks(batch_size) {
                if context.cancellation.is_cancelled() {
                    return Err(AppError::new(JOB_CANCELLED));
                }
                require_permissions(&self.account, &context.execution, PERMISSIONS).await?;
                let mut tx = context.db.begin().await.map_err(safe_error)?;
                // 同批按 ID 加锁，避免两个交叉选择的任务以相反顺序锁行。
                let mut ordered: Vec<_> = batch.iter().collect();
                ordered.sort_by_key(|sample| sample.id);
                for sample in ordered {
                    let row = samples::locked(&mut tx, owner, sample.id).await?;
                    samples::check_version(&row, sample.row_version)?;
                    samples::write(
                        &mut tx,
                        samples::update(owner, sample.id, sample.row_version)
                            .value("stage", DemoSampleStage::Ready.as_str())
                            .value("character_count", row.note.chars().count() as i64)
                            .to_owned(),
                    )
                    .await?;
                }
                tx.commit().await.map_err(safe_error)?;
                processed += batch.len() as i64;
                context.set_failure_result(json!({"processed": processed, "total": total}))?;
                context
                    .progress(
                        processed,
                        total,
                        "demo.progress.measure",
                        BTreeMap::from([
                            ("current".into(), processed.to_string()),
                            ("total".into(), total.to_string()),
                        ]),
                    )
                    .await
                    .map_err(safe_error)?;
            }
            Ok(json!({"processed": processed, "total": total}))
        })
    }
}
