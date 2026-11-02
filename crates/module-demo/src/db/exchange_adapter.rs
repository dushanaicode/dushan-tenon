use super::*;
use std::path::{Path, PathBuf};
use tenon_framework::job::{JobContext, JobFuture, JobSubmitted};

// 测试只接显式路径，以任务 ID 查找内存路径；不模拟宿主的令牌转交协议。
pub(super) type Paths = Arc<Mutex<BTreeMap<Id, PathBuf>>>;

struct ExchangeJob {
    service: Arc<DemoService>,
    paths: Paths,
    import: bool,
}

pub(super) fn host_handlers(service: Arc<DemoService>, paths: Paths) -> Vec<Arc<dyn JobHandler>> {
    [true, false]
        .into_iter()
        .map(|import| {
            Arc::new(ExchangeJob {
                service: service.clone(),
                paths: paths.clone(),
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
            jobs::require_permissions(
                &self.service.account,
                &context.execution,
                self.permissions(),
            )
            .await?;
            let path = self
                .paths
                .lock()
                .unwrap()
                .remove(&context.id())
                .ok_or_else(|| AppError::new(INTERNAL_UNEXPECTED))?;
            let format = serde_json::from_value(context.payload["format"].clone()).unwrap();
            let language = serde_json::from_value(context.payload["language"].clone()).unwrap();
            if self.import {
                let options = serde_json::from_value(context.payload["options"].clone()).unwrap();
                self.service
                    .run_import(&context, &path, format, &options, language)
                    .await
            } else {
                let options = serde_json::from_value(context.payload["options"].clone()).unwrap();
                self.service
                    .run_export(&context, &path, format, &options, language)
                    .await
            }
        })
    }
}

impl Fixture {
    pub(super) async fn export(
        &self,
        path: &Path,
        format: ExchangeFormat,
        options: DemoExportOptions,
    ) -> Result<JobSubmitted, AppError> {
        let language = self.service.prepare_export(&self.actor, &options)?;
        let submitted = jobs::submit(
            &self.service,
            &self.queue,
            &self.actor,
            "demo.sample_export",
            json!({ "format": format, "options": options, "language": language }),
        )
        .await?;
        self.paths
            .lock()
            .unwrap()
            .insert(submitted.job_id, path.to_owned());
        Ok(submitted)
    }

    pub(super) async fn import(
        &self,
        path: &Path,
        format: ExchangeFormat,
        mode: DemoImportMode,
    ) -> Result<JobSubmitted, AppError> {
        let language = self.service.prepare_import(&self.actor)?;
        let submitted = jobs::submit(&self.service, &self.queue, &self.actor, "demo.sample_import", json!({ "format": format, "options": DemoImportOptions { mode }, "language": language })).await?;
        self.paths
            .lock()
            .unwrap()
            .insert(submitted.job_id, path.to_owned());
        Ok(submitted)
    }
}
