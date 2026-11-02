//! 文件服务夹具；复用数据库夹具，不让 db 反向构造文件服务。

use super::{FilePurposeDeclaration, FileStore};
use crate::{db::test_support::TestDb, error::AppError, instance::InstanceId};

pub fn file_store(
    test: &TestDb,
    max_mib: u64,
    declarations: &[FilePurposeDeclaration],
) -> Result<FileStore, AppError> {
    Ok(FileStore::new(
        test.db.clone(),
        test.root.path(),
        InstanceId::load_or_create(test.root.path())?,
        max_mib,
        declarations,
    ))
}
