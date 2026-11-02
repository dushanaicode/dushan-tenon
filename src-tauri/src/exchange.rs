//! 任务中的文件接入适配；持久载荷只包含一次性句柄、格式和领域选项。

use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tenon_desktop::picked_files::{FilePurpose, PickedFileStore};
use tenon_framework::{
    actor::Actor,
    error::{AppError, INPUT_INVALID, PERMISSION_DENIED},
    exchange::ExchangeFormat,
    i18n::Language,
    job::{JobContext, JobFuture, JobHandler, PermissionLookup},
};
use tenon_module_account::AccountService;
use tenon_module_demo::{DemoExportOptions, DemoImportOptions, DemoService};

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExchangePayload<T> {
    pub handle: String,
    pub format: ExchangeFormat,
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
                    Some(payload.format),
                )?;
                self.demo
                    .run_import(
                        &context,
                        &file.path,
                        payload.format,
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
                    Some(payload.format),
                )?;
                self.demo
                    .run_export(
                        &context,
                        &file.path,
                        payload.format,
                        &payload.options,
                        payload.language,
                    )
                    .await
            }
        })
    }
}

fn decode<T: serde::de::DeserializeOwned>(
    context: &JobContext,
) -> Result<ExchangePayload<T>, AppError> {
    serde_json::from_value(context.payload.clone())
        .map_err(|_| AppError::new(INPUT_INVALID).with_param("path", "payload"))
}

#[cfg(test)]
mod tests;
