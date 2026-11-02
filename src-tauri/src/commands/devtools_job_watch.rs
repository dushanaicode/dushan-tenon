use super::{AppState, JobEvent, JobId};
use crate::stream::ChannelSink;
use tenon_framework::{
    actor::Actor,
    error::{AppError, IpcError, PERMISSION_DENIED},
    ipc,
    stream::{StreamEvent, StreamOwner},
};
use tenon_module_account::AUTH_REQUIRED;

#[tauri::command]
pub async fn devtools_job_watch<R: tauri::Runtime>(
    window: tauri::WebviewWindow<R>,
    state: tauri::State<'_, AppState>,
    input: JobId,
    channel: tauri::ipc::Channel<StreamEvent<JobEvent>>,
) -> Result<(), IpcError> {
    ipc::execute(
        state.inner(),
        stringify!(devtools_job_watch),
        |state| async move {
            let actor = state.execution.actor;
            state.jobs.get(input.id).await?;
            let stream = state.streams.open(
                StreamOwner {
                    actor,
                    scope: window.label().into(),
                },
                ChannelSink(channel),
            )?;
            let queue = state.jobs.clone();
            let account = state.account.clone();
            let permissions = state.identity.permission_lookup.clone();
            tauri::async_runtime::spawn(async move {
                let still_authorized = || async {
                    if !permissions
                        .has_permission(actor, "devtools.job.read")
                        .await?
                    {
                        return Err(AppError::new(PERMISSION_DENIED)
                            .with_param("permission", "devtools.job.read"));
                    }
                    let Actor::User(user) = actor else {
                        return Err(AppError::new(AUTH_REQUIRED));
                    };
                    account
                        .with_active_user(user, || Ok(()))
                        .await?
                        .ok_or_else(|| AppError::new(AUTH_REQUIRED))
                };
                if let Err(error) =
                    tenon_framework::job::watch(&queue, input.id, &stream, still_authorized).await
                {
                    let _ = stream.failed(error.code().as_str().into(), Default::default());
                    tracing::warn!(code = %error.code(), "任务监视流结束");
                }
            });
            Ok(())
        },
    )
    .await
}
