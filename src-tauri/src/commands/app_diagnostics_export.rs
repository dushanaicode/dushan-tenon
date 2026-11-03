use super::{AppState, DiagnosticExportInput, FileArtifact};
use tauri::Manager;
use tenon_framework::{error::IpcError, ipc, stream::StreamOwner};

#[tauri::command]
pub async fn app_diagnostics_export<R: tauri::Runtime>(
    window: tauri::WebviewWindow<R>,
    state: tauri::State<'_, AppState>,
    input: DiagnosticExportInput,
) -> Result<FileArtifact, IpcError> {
    ipc::execute(
        state.inner(),
        stringify!(app_diagnostics_export),
        |state| async move {
            crate::diagnostics::export(
                window.app_handle().clone(),
                StreamOwner {
                    actor: state.execution.actor,
                    scope: window.label().into(),
                },
                input.file_token,
            )
            .await
        },
    )
    .await
}
