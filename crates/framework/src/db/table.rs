/// 表能力按表显式声明；启用的能力要求表结构具有对应的固定列。
#[derive(Clone, Copy, Debug)]
pub struct Table {
    pub name: &'static str,
    pub audit: bool,
    pub soft_delete: bool,
    pub optimistic_lock: bool,
}

pub(super) const ID: &str = "id";
pub(super) const CREATED_AT: &str = "created_at";
pub(super) const CREATED_BY: &str = "created_by";
pub(super) const UPDATED_AT: &str = "updated_at";
pub(super) const UPDATED_BY: &str = "updated_by";
pub(super) const DELETED_AT: &str = "deleted_at";
pub(super) const DELETE_TOKEN: &str = "delete_token";
pub(super) const ROW_VERSION: &str = "row_version";

pub(super) const RESERVED_COLUMNS: &[&str] = &[
    ID,
    CREATED_AT,
    CREATED_BY,
    UPDATED_AT,
    UPDATED_BY,
    DELETED_AT,
    DELETE_TOKEN,
    ROW_VERSION,
];
