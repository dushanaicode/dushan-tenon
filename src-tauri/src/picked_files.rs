//! 原生选择器；过滤与一次性文件令牌复用 desktop。

use std::path::PathBuf;
use tauri_plugin_dialog::DialogExt;
use tenon_desktop::picked_files::{
    FilePickInput, FilePicked, FilePurpose, PickedFileStore, filters,
};
use tenon_framework::{
    actor::Actor,
    error::{AppError, INPUT_INVALID, INTERNAL_UNEXPECTED},
};

pub(crate) async fn pick<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    store: &PickedFileStore,
    actor: Actor,
    input: FilePickInput,
) -> Result<Option<FilePicked>, AppError> {
    pick_with(store, actor, input, async |input, extensions| {
        let mut dialog = app.dialog().file().add_filter(
            extensions.join(" / "),
            &extensions.iter().map(String::as_str).collect::<Vec<_>>(),
        );
        if let Some(name) = &input.suggested_name {
            let mut name = PathBuf::from(name);
            if input.purpose == FilePurpose::Save {
                name.set_extension(&extensions[0]);
            }
            dialog = dialog.set_file_name(name.to_string_lossy());
        }
        let (sender, receiver) = tokio::sync::oneshot::channel();
        match input.purpose {
            FilePurpose::Export
            | FilePurpose::Save
            | FilePurpose::BackupExport
            | FilePurpose::DiagnosticsExport => {
                dialog.save_file(move |file| {
                    let _ = sender.send(file);
                });
            }
            FilePurpose::Import | FilePurpose::Store | FilePurpose::BackupRestore => {
                dialog.pick_file(move |file| {
                    let _ = sender.send(file);
                });
            }
        }
        receiver
            .await
            .map_err(|_| AppError::new(INTERNAL_UNEXPECTED))?
            .map(|file| {
                file.into_path()
                    .map_err(|_| AppError::new(INPUT_INVALID).with_param("path", "file"))
            })
            .transpose()
    })
    .await
}

async fn pick_with(
    store: &PickedFileStore,
    actor: Actor,
    input: FilePickInput,
    select: impl AsyncFnOnce(&FilePickInput, &[String]) -> Result<Option<PathBuf>, AppError>,
) -> Result<Option<FilePicked>, AppError> {
    let extensions = filters(&input)?;
    select(&input, &extensions)
        .await?
        .map(|path| store.insert(actor, input.purpose, path, &extensions))
        .transpose()
}

#[cfg(test)]
mod tests {
    use super::*;
    use tenon_framework::{exchange::ExchangeFormat, id::Id};

    #[tokio::test]
    async fn selection_validates_before_dialog_and_returns_only_a_single_use_token() {
        let store = PickedFileStore::default();
        let actor = Actor::User(Id::new());
        let input = || FilePickInput {
            purpose: FilePurpose::Export,
            format: Some(ExchangeFormat::Csv),
            suggested_name: None,
            extensions: None,
        };
        let picked = pick_with(&store, actor, input(), async |_, extensions| {
            assert_eq!(extensions, ["csv"]);
            Ok(Some(PathBuf::from("private-folder/sample.csv")))
        })
        .await
        .unwrap()
        .unwrap();
        let json = serde_json::to_string(&picked).unwrap();
        assert!(!json.contains("private-folder"));
        assert_eq!(picked.file_name, "sample.csv");
        store
            .take(
                &picked.token,
                actor,
                FilePurpose::Export,
                Some(ExchangeFormat::Csv),
            )
            .unwrap();
        assert!(
            store
                .take(&picked.token, actor, FilePurpose::Export, None)
                .is_err()
        );
        assert!(
            pick_with(&store, actor, input(), async |_, _| Ok(None))
                .await
                .unwrap()
                .is_none()
        );
        let mut invalid = input();
        invalid.format = None;
        assert!(
            pick_with(&store, actor, invalid, async |_, _| panic!(
                "invalid request opened dialog"
            ))
            .await
            .is_err()
        );
    }
}
