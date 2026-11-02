//! 数据库与缓存共用的秘密键及 CA 文件校验，路径在加载时解析一次。

use std::{
    fs,
    path::{Path, PathBuf},
};

use tenon_framework::secret::validate_key;

use super::ConfigError;

pub(super) fn secret_and_ca(
    section: &str,
    secret: &str,
    ca: Option<PathBuf>,
    root: &Path,
) -> Result<Option<PathBuf>, ConfigError> {
    let field = |key: &str, reason: &str| ConfigError::field(format!("{section}.{key}"), reason);
    validate_key(secret).map_err(|_| field("password_secret", "必须为点分小写秘密键名"))?;
    let Some(path) = ca else { return Ok(None) };
    if path.as_os_str().is_empty() {
        return Err(field("tls_ca_file", "CA 文件路径不能为空"));
    }
    let absolute = root.join(path);
    let file = fs::File::open(&absolute).map_err(|_| field("tls_ca_file", "无法读取 CA 文件"))?;
    if !file
        .metadata()
        .map_err(|_| field("tls_ca_file", "无法读取 CA 文件属性"))?
        .is_file()
    {
        return Err(field("tls_ca_file", "必须为普通 CA 文件"));
    }
    absolute
        .canonicalize()
        .map(Some)
        .map_err(|_| field("tls_ca_file", "无法解析 CA 文件路径"))
}
