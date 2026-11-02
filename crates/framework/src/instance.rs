//! 状态目录的持久实例标识；已有非法标识不覆盖，跨重启保留执行归属，仅依赖 error、id。
use std::{
    fmt, fs,
    io::{self, Write},
    path::Path,
};

use crate::{
    error::{AppError, INPUT_INVALID, INTERNAL_UNEXPECTED},
    id::Id,
};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct InstanceId(Id);

impl InstanceId {
    pub fn load_or_create(state_root: &Path) -> Result<Self, AppError> {
        let path = state_root.join("instance-id");
        match fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&path)
        {
            Ok(mut file) => {
                let id = Self(Id::new());
                writeln!(file, "{id}")
                    .and_then(|()| file.sync_all())
                    .map_err(|error| AppError::new(INTERNAL_UNEXPECTED).with_source(error))?;
                Ok(id)
            }
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {
                let content = fs::read_to_string(path)
                    .map_err(|error| AppError::new(INPUT_INVALID).with_source(error))?;
                content
                    .strip_suffix('\n')
                    .and_then(|value| value.parse::<Id>().ok())
                    .map(Self)
                    .ok_or_else(|| {
                        AppError::new(INPUT_INVALID)
                            .with_param("path", "instance-id")
                            .with_source(io::Error::new(
                                io::ErrorKind::InvalidData,
                                "instance-id 内容不合法：须为小写带连字符的 UUID v7 加换行；请恢复原文件，不得重新生成，否则排队中的本机任务将失去归属",
                            ))
                    })
            }
            Err(error) => Err(AppError::new(INTERNAL_UNEXPECTED).with_source(error)),
        }
    }
}

impl fmt::Display for InstanceId {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.0.fmt(formatter)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn creates_and_reloads_the_same_instance_id() {
        let root = tempfile::tempdir().unwrap();
        let id = InstanceId::load_or_create(root.path()).unwrap();
        assert_eq!(InstanceId::load_or_create(root.path()).unwrap(), id);
        assert_eq!(
            fs::read_to_string(root.path().join("instance-id")).unwrap(),
            format!("{id}\n")
        );
        assert!(id.to_string().parse::<Id>().is_ok());
    }

    #[test]
    fn invalid_instance_id_is_rejected_without_overwriting() {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("instance-id");
        let id = Id::new().to_string();
        for content in [
            String::new(),
            "invalid\n".into(),
            id.clone(),
            format!("{id}\r\n"),
            format!("{id}\n\n"),
            format!(" {}\n", id),
            "0199bca1-1234-7123-8123-ABCDEF012345\n".into(),
            format!("{}\n", uuid::Uuid::new_v4()),
        ] {
            fs::write(&path, &content).unwrap();
            let error = InstanceId::load_or_create(root.path()).unwrap_err();
            assert_eq!(error.code(), INPUT_INVALID);
            assert!(format!("{error:?}").contains("instance-id 内容不合法"));
            assert_eq!(fs::read_to_string(&path).unwrap(), content);
        }
        fs::write(&path, [0xff]).unwrap();
        assert!(InstanceId::load_or_create(root.path()).is_err());
        assert_eq!(fs::read(&path).unwrap(), [0xff]);
    }
}
