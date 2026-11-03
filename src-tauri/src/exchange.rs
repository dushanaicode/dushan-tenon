//! 任务中的文件接入适配；持久载荷只包含一次性句柄、格式和领域选项。

use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tenon_desktop::picked_files::{FilePurpose, PickedFileStore};
use tenon_framework::{
    actor::{Actor, ExecutionContext},
    error::{AppError, INPUT_INVALID, PERMISSION_DENIED},
    exchange::ExchangeFormat,
    i18n::Language,
    job::{JobContext, JobFuture, JobHandler, JobSubmitted, PermissionLookup, SubmitJob},
};
use tenon_module_account::AccountService;
use tenon_module_demo::{DemoExportOptions, DemoImportOptions, DemoService};

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExchangePayload<T> {
    pub handle: String,
    // 导出由用户指定格式；导入使用令牌内原文件的格式。
    pub format: Option<ExchangeFormat>,
    pub options: T,
    pub language: Language,
}

struct ExchangeJob {
    account: Arc<AccountService>,
    demo: Arc<DemoService>,
    files: Arc<PickedFileStore>,
    import: bool,
}

pub(crate) fn handlers(
    account: Arc<AccountService>,
    demo: Arc<DemoService>,
    files: Arc<PickedFileStore>,
) -> Vec<Arc<dyn JobHandler>> {
    [true, false]
        .into_iter()
        .map(|import| {
            Arc::new(ExchangeJob {
                account: account.clone(),
                demo: demo.clone(),
                files: files.clone(),
                import,
            }) as Arc<dyn JobHandler>
        })
        .collect()
}

impl JobHandler for ExchangeJob {
    fn kind(&self) -> &'static str {
        if self.import {
            "demo.sample_import"
        } else {
            "demo.sample_export"
        }
    }

    fn permissions(&self) -> &'static [&'static str] {
        if self.import {
            &["demo.sample.write", "demo.sample.import"]
        } else {
            &["demo.sample.read", "demo.sample.export"]
        }
    }

    fn local_only(&self) -> bool {
        true
    }
    fn retry_safe(&self) -> bool {
        false
    }
    fn max_attempts(&self) -> i32 {
        1
    }

    fn run(&self, context: JobContext) -> JobFuture<'_> {
        Box::pin(async move {
            if !matches!(context.execution.actor, Actor::User(_)) {
                return Err(AppError::new(PERMISSION_DENIED));
            }
            for permission in self.permissions() {
                if !self
                    .account
                    .has_permission(context.execution.actor, permission)
                    .await?
                {
                    return Err(
                        AppError::new(PERMISSION_DENIED).with_param("permission", *permission)
                    );
                }
            }
            if self.import {
                let payload: ExchangePayload<DemoImportOptions> = decode(&context)?;
                let file = self.files.take_handoff(
                    &payload.handle,
                    context.execution.actor,
                    FilePurpose::Import,
                    payload.format,
                )?;
                self.demo
                    .run_import(
                        &context,
                        &file.path,
                        file.format.ok_or_else(|| AppError::new(INPUT_INVALID))?,
                        &payload.options,
                        payload.language,
                    )
                    .await
            } else {
                let payload: ExchangePayload<DemoExportOptions> = decode(&context)?;
                let file = self.files.take_handoff(
                    &payload.handle,
                    context.execution.actor,
                    FilePurpose::Export,
                    payload.format,
                )?;
                self.demo
                    .run_export(
                        &context,
                        &file.path,
                        file.format.ok_or_else(|| AppError::new(INPUT_INVALID))?,
                        &payload.options,
                        payload.language,
                    )
                    .await
            }
        })
    }
}

pub(crate) async fn export(
    state: &crate::state::AppState,
    execution: &ExecutionContext,
    input: dushan_tenon_lib::contract::DemoExportInput,
) -> Result<JobSubmitted, AppError> {
    let options = DemoExportOptions {
        keyword: input.keyword,
        stage: input.stage,
    };
    let language = state.demo.prepare_export(execution, &options)?;
    submit(
        state,
        execution,
        &input.file_token,
        FilePurpose::Export,
        Some(input.format),
        options,
        language,
    )
    .await
}

pub(crate) async fn import(
    state: &crate::state::AppState,
    execution: &ExecutionContext,
    input: dushan_tenon_lib::contract::DemoImportInput,
) -> Result<JobSubmitted, AppError> {
    let language = state.demo.prepare_import(execution)?;
    submit(
        state,
        execution,
        &input.file_token,
        FilePurpose::Import,
        None,
        DemoImportOptions { mode: input.mode },
        language,
    )
    .await
}

async fn submit<T: Serialize>(
    state: &crate::state::AppState,
    execution: &ExecutionContext,
    token: &str,
    purpose: FilePurpose,
    format: Option<ExchangeFormat>,
    options: T,
    language: Language,
) -> Result<JobSubmitted, AppError> {
    let Actor::User(owner) = execution.actor else {
        return Err(AppError::new(PERMISSION_DENIED));
    };
    state
        .picked_files
        .handoff(
            token,
            execution.actor,
            purpose,
            format,
            |handle| async move {
                let payload = ExchangePayload {
                    handle,
                    format,
                    options,
                    language,
                };
                let id = state
                    .jobs
                    .submit(
                        &state.db,
                        SubmitJob {
                            kind: if purpose == FilePurpose::Import {
                                "demo.sample_import"
                            } else {
                                "demo.sample_export"
                            }
                            .into(),
                            payload: serde_json::to_value(payload)
                                .map_err(crate::boot::internal)?,
                            priority: 0,
                            run_after: None,
                            submitted_by: Some(owner),
                        },
                    )
                    .await?;
                Ok(JobSubmitted { job_id: id })
            },
        )
        .await
}

fn decode<T: serde::de::DeserializeOwned>(
    context: &JobContext,
) -> Result<ExchangePayload<T>, AppError> {
    serde_json::from_value(context.payload.clone())
        .map_err(|_| AppError::new(INPUT_INVALID).with_param("path", "payload"))
}

#[cfg(test)]
mod tests;
