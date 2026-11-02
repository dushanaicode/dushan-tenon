//! 状态根的来源选择与逐分量目录校验；平台默认值由宿主提供。
use std::{
    env,
    ffi::OsString,
    fs,
    path::{Component, Path, PathBuf},
};

use thiserror::Error;

#[derive(Debug, Error)]
pub enum StateRootError {
    #[error("命令行工具需要 --state-root <PATH> 或 TENON_STATE_ROOT")]
    MissingRoot,
    #[error("状态目录含链接、非目录或父级跳转: {0}")]
    InvalidPath(PathBuf),
    #[error("状态目录来源 {0} 的路径不能为空")]
    EmptyPath(&'static str),
    #[error("无法解析应用数据目录: {0}")]
    AppData(#[source] Box<dyn std::error::Error + Send + Sync>),
    #[error("无法创建状态目录 {path}: {source}")]
    Create {
        path: PathBuf,
        source: std::io::Error,
    },
    #[error("无法将状态目录转换为绝对路径 {path}: {source}")]
    Absolute {
        path: PathBuf,
        source: std::io::Error,
    },
}

#[derive(Debug, PartialEq, Eq)]
enum StateRootSource {
    Explicit(PathBuf),
    AppData,
}

// 只选择来源并校验显式空值；不读环境变量、不访问文件系统。
fn select_source(
    cli: Option<PathBuf>,
    environment: Option<OsString>,
) -> Result<StateRootSource, StateRootError> {
    let (path, source) = match (cli, environment) {
        (Some(path), _) => (path, "--state-root"),
        (None, Some(path)) => (PathBuf::from(path), "TENON_STATE_ROOT"),
        (None, None) => return Ok(StateRootSource::AppData),
    };
    if path.as_os_str().is_empty() {
        return Err(StateRootError::EmptyPath(source));
    }
    Ok(StateRootSource::Explicit(path))
}

pub fn resolve(
    cli: Option<PathBuf>,
    default: impl FnOnce() -> Result<PathBuf, Box<dyn std::error::Error + Send + Sync>>,
) -> Result<PathBuf, StateRootError> {
    resolve_from(cli, env::var_os("TENON_STATE_ROOT"), default)
}

fn resolve_from(
    cli: Option<PathBuf>,
    environment: Option<OsString>,
    default: impl FnOnce() -> Result<PathBuf, Box<dyn std::error::Error + Send + Sync>>,
) -> Result<PathBuf, StateRootError> {
    let path = match select_source(cli, environment)? {
        StateRootSource::Explicit(path) => path,
        StateRootSource::AppData => default().map_err(StateRootError::AppData)?,
    };
    if path.as_os_str().is_empty() {
        return Err(StateRootError::EmptyPath("platform default"));
    }
    let path = absolute_path(path)?;
    create_directory(&path)?;
    Ok(path)
}

/// CLI 没有平台目录回退；未提供显式根时失败。
pub fn resolve_cli(cli: Option<PathBuf>) -> Result<PathBuf, StateRootError> {
    if cli.is_none() && env::var_os("TENON_STATE_ROOT").is_none() {
        return Err(StateRootError::MissingRoot);
    }
    resolve(cli, || Err(StateRootError::MissingRoot.into()))
}

fn absolute_path(path: PathBuf) -> Result<PathBuf, StateRootError> {
    if path
        .components()
        .any(|part| matches!(part, Component::ParentDir))
    {
        return Err(StateRootError::InvalidPath(path));
    }
    std::path::absolute(&path).map_err(|source| StateRootError::Absolute { path, source })
}

/// 在创建每个缺失分量前检查其祖先；Windows 同时拒绝所有 reparse points。
pub(crate) fn create_directory(path: &Path) -> Result<(), StateRootError> {
    let path = absolute_path(path.into())?;
    let mut current = PathBuf::new();
    for part in path.components() {
        current.push(part);
        if matches!(part, Component::Prefix(_)) {
            continue;
        }
        let metadata = match fs::symlink_metadata(&current) {
            Ok(metadata) => metadata,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                match fs::create_dir(&current) {
                    Ok(()) => {}
                    Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {}
                    Err(source) => {
                        return Err(StateRootError::Create {
                            path: current,
                            source,
                        });
                    }
                }
                fs::symlink_metadata(&current).map_err(|source| StateRootError::Create {
                    path: current.clone(),
                    source,
                })?
            }
            Err(source) => {
                return Err(StateRootError::Create {
                    path: current,
                    source,
                });
            }
        };
        if !metadata.is_dir() || metadata.file_type().is_symlink() {
            return Err(StateRootError::InvalidPath(current));
        }
        #[cfg(windows)]
        {
            use std::os::windows::fs::MetadataExt;
            if metadata.file_attributes() & 0x400 != 0 {
                return Err(StateRootError::InvalidPath(current));
            }
        }
    }
    Ok(())
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    #[test]
    fn command_line_takes_precedence_over_environment() {
        let selected = select_source(Some("cli-state".into()), Some("env-state".into())).unwrap();
        assert_eq!(selected, StateRootSource::Explicit("cli-state".into()));
    }

    #[test]
    fn environment_is_used_without_command_line() {
        let selected = select_source(None, Some("env-state".into())).unwrap();
        assert_eq!(selected, StateRootSource::Explicit("env-state".into()));
    }

    #[test]
    fn absent_overrides_select_application_data_directory() {
        assert_eq!(select_source(None, None).unwrap(), StateRootSource::AppData);
    }

    #[test]
    fn empty_command_line_is_an_error_instead_of_falling_back() {
        assert!(matches!(
            select_source(Some(PathBuf::new()), Some("env-state".into())),
            Err(StateRootError::EmptyPath("--state-root"))
        ));
    }

    #[test]
    fn empty_environment_is_an_error_instead_of_falling_back() {
        assert!(matches!(
            select_source(None, Some(OsString::new())),
            Err(StateRootError::EmptyPath("TENON_STATE_ROOT"))
        ));
    }

    #[test]
    fn unused_environment_does_not_invalidate_command_line() {
        let selected = select_source(Some("cli-state".into()), Some(OsString::new())).unwrap();
        assert_eq!(selected, StateRootSource::Explicit("cli-state".into()));
    }

    #[test]
    fn relative_path_becomes_absolute_without_extended_length_prefix() {
        let path = absolute_path(PathBuf::from("Temp/state-root-test")).unwrap();
        assert!(path.is_absolute());
        assert!(!path.to_string_lossy().starts_with(r"\\?\"));
        assert_eq!(
            path,
            env::current_dir().unwrap().join("Temp/state-root-test")
        );
    }

    #[test]
    fn resolver_creates_nested_roots_and_only_calls_needed_default() {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("nested/state");
        assert_eq!(
            resolve_from(Some(path.clone()), None, || panic!("unused default")).unwrap(),
            path
        );
        assert!(path.is_dir());
        let default = root.path().join("platform");
        assert_eq!(
            resolve_from(None, None, || Ok(default.clone())).unwrap(),
            default
        );
        assert!(matches!(
            resolve_from(None, None, || Err(StateRootError::MissingRoot.into())),
            Err(StateRootError::AppData(_))
        ));
        assert!(matches!(
            resolve_from(None, None, || Ok(PathBuf::new())),
            Err(StateRootError::EmptyPath(_))
        ));
        let file = root.path().join("file");
        fs::write(&file, b"file").unwrap();
        assert!(matches!(
            resolve_from(Some(file.join("child")), None, || panic!("unused")),
            Err(StateRootError::InvalidPath(_))
        ));
    }

    pub(crate) fn link_directory(target: &Path, link: &Path) {
        #[cfg(unix)]
        std::os::unix::fs::symlink(target, link).unwrap();
        #[cfg(windows)]
        {
            let output = std::process::Command::new("cmd")
                .args(["/c", "mklink", "/J"])
                .arg(link)
                .arg(target)
                .output()
                .unwrap();
            assert!(
                output.status.success(),
                "{}",
                String::from_utf8_lossy(&output.stderr)
            );
        }
    }

    #[test]
    fn linked_components_and_parent_traversal_are_rejected_before_creating_children() {
        let root = tempfile::tempdir().unwrap();
        let real = root.path().join("real");
        fs::create_dir(&real).unwrap();
        let link = root.path().join("link");
        link_directory(&real, &link);
        for path in [link.clone(), link.join("child"), link.join("../bypass")] {
            assert!(matches!(
                resolve_from(Some(path), None, || panic!("unused")),
                Err(StateRootError::InvalidPath(_))
            ));
        }
        assert!(!real.join("child").exists());
        assert!(!root.path().join("bypass").exists());
    }
}
