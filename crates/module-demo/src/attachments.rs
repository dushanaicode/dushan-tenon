use std::path::Path;

use tenon_framework::{
    actor::ExecutionContext,
    db::PageRequest,
    error::{AppError, DATA_NOT_FOUND},
    file::{FileListInput, FilePreview},
    id::Id,
};

use crate::{
    ATTACHMENT_EXISTS, DemoAttachment, DemoSample, DemoSampleId, DemoSampleVersion, DemoService,
    DemoStarted, safe_error, samples,
};

impl DemoStarted {
    pub(crate) async fn attachment(&self, id: Id) -> Result<DemoAttachment, AppError> {
        let record = self.files.get(id).await.map_err(safe_error)?;
        // FileStore::get 仅读元数据；列表公开接口才探测 missing，不拼私有磁盘路径。
        let mut page = 1;
        loop {
            let records = self
                .files
                .list(FileListInput {
                    pagination: PageRequest {
                        page,
                        page_size: 100,
                    },
                    purpose: Some("demo.attachment".into()),
                    keyword: Some(record.original_name.clone()),
                })
                .await
                .map_err(safe_error)?;
            if let Some(record) = records.items.into_iter().find(|record| record.id == id) {
                return Ok(DemoAttachment {
                    id: record.id,
                    name: record.original_name,
                    extension: record.extension,
                    bytes: record.size_bytes,
                    missing: record.missing,
                });
            }
            if i64::from(page) * 100 >= records.total {
                return Err(AppError::new(DATA_NOT_FOUND));
            }
            page += 1;
        }
    }

    pub(crate) async fn delete_attachment(&self, id: Id) -> Result<(), AppError> {
        let record = self.files.get(id).await.map_err(safe_error)?;
        // S17：登记删除已提交后，磁盘清理沿 FileStore 的尽力回收合同。
        self.files
            .delete(id, record.row_version)
            .await
            .map_err(safe_error)
    }
}

impl DemoService {
    pub async fn attachment_add(
        &self,
        context: &ExecutionContext,
        input: DemoSampleVersion,
        source: &Path,
    ) -> Result<DemoSample, AppError> {
        let (owner, _) = self.enter(context)?;
        let started = self.started()?;
        let row = samples::get(&started.db, owner, input.id).await?;
        samples::check_version(&row, input.row_version)?;
        if row.attachment_id.is_some() {
            return Err(AppError::new(ATTACHMENT_EXISTS));
        }
        let record = started
            .files
            .add(context, "demo.attachment", source)
            .await
            .map_err(safe_error)?;
        let bind = async {
            let mut tx = started.db.begin().await.map_err(safe_error)?;
            let row = samples::locked(&mut tx, owner, input.id).await?;
            samples::check_version(&row, input.row_version)?;
            if row.attachment_id.is_some() {
                return Err(AppError::new(ATTACHMENT_EXISTS));
            }
            samples::write(
                &mut tx,
                samples::update(owner, input.id, input.row_version)
                    .value("attachment_id", record.id)
                    .to_owned(),
            )
            .await?;
            tx.commit().await.map_err(safe_error)
        }
        .await;
        if let Err(error) = bind {
            started
                .files
                .delete(record.id, record.row_version)
                .await
                .map_err(safe_error)?;
            return Err(error);
        }
        started
            .present(samples::get(&started.db, owner, input.id).await?)
            .await
    }

    pub async fn attachment_preview(
        &self,
        context: &ExecutionContext,
        input: DemoSampleId,
    ) -> Result<FilePreview, AppError> {
        let (owner, _) = self.enter(context)?;
        let started = self.started()?;
        let row = samples::get(&started.db, owner, input.id).await?;
        let id = row
            .attachment_id
            .ok_or_else(|| AppError::new(DATA_NOT_FOUND))?;
        started.files.preview(id).await.map_err(safe_error)
    }

    pub async fn attachment_save(
        &self,
        context: &ExecutionContext,
        input: DemoSampleId,
        destination: &Path,
    ) -> Result<(), AppError> {
        let (owner, _) = self.enter(context)?;
        let started = self.started()?;
        let row = samples::get(&started.db, owner, input.id).await?;
        let id = row
            .attachment_id
            .ok_or_else(|| AppError::new(DATA_NOT_FOUND))?;
        started
            .files
            .save_copy(id, destination)
            .await
            .map_err(safe_error)
    }

    pub async fn attachment_remove(
        &self,
        context: &ExecutionContext,
        input: DemoSampleVersion,
    ) -> Result<DemoSample, AppError> {
        let (owner, _) = self.enter(context)?;
        let started = self.started()?;
        let mut tx = started.db.begin().await.map_err(safe_error)?;
        let row = samples::locked(&mut tx, owner, input.id).await?;
        samples::check_version(&row, input.row_version)?;
        let id = row
            .attachment_id
            .ok_or_else(|| AppError::new(DATA_NOT_FOUND))?;
        samples::write(
            &mut tx,
            samples::update(owner, input.id, input.row_version)
                .value("attachment_id", Option::<String>::None)
                .to_owned(),
        )
        .await?;
        tx.commit().await.map_err(safe_error)?;
        started.delete_attachment(id).await?;
        started
            .present(samples::get(&started.db, owner, input.id).await?)
            .await
    }
}
