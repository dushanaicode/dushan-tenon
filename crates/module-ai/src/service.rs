use std::{
    collections::BTreeMap,
    sync::{
        Arc, Mutex, MutexGuard, OnceLock,
        atomic::{AtomicBool, Ordering},
    },
    time::Duration,
};

use tenon_framework::{
    actor::{Actor, ExecutionContext},
    db::Db,
    error::{AppError, ErrorCode, INTERNAL_UNEXPECTED, PERMISSION_DENIED},
    id::Id,
    job::PermissionLookup,
    module::{Module, ModuleContext, ModuleDeclaration, ModuleFuture},
    network::ProxySnapshot,
    param::ParamStore,
    stream::{
        STREAM_CLOSED, STREAM_FORBIDDEN, Stream, StreamEvent, StreamOwner, StreamRegistry,
        StreamSink,
    },
};
use tenon_module_account::{AUTH_REQUIRED, AccountService};
use tokio::{
    sync::Notify,
    time::{Instant, interval, sleep_until, timeout},
};
use tokio_util::sync::CancellationToken;

use crate::{
    AiCancelInput, AiChatInput, AiConnectionTest, AiFinishReason, AiMessage, AiPart, AiPartKind,
    AiRole, AiStreamData, AiUpdate, AiUsage, BUSY, CANCELLED, COALESCE_BYTES, COALESCE_MS,
    CONFLICT, CONNECT_FAILED, DECLARATION, LIMIT, MAX_ACTIVE_REQUESTS, MAX_RESPONSE_BYTES,
    MAX_STREAM_DELTAS, PREPARE_TIMEOUT_SECONDS, RESULT_UNKNOWN, SHUTDOWN_TIMEOUT,
    SHUTDOWN_TIMEOUT_SECONDS, TIMEOUT,
    client::{self, Config, HttpClient, Mapping},
    sse::Decoder,
};

impl AiService {
    /// 仅用于已清除 secret_set 的 staged 库；服务地址回到声明默认值。
    pub async fn unbind_restored_credentials(db: &Db) -> Result<(), AppError> {
        tenon_framework::backup::restore::reset_parameter(db, &crate::BASE_URL_PARAM).await
    }
}

/// 单服务流式聊天；账号服务负责活动身份，代理端口按请求提供一致快照。
pub struct AiService {
    account: Arc<AccountService>,
    proxy: Arc<dyn Fn(bool) -> Result<ProxySnapshot, AppError> + Send + Sync>,
    started: OnceLock<Started>,
    runs: Mutex<Runs>,
    changed: Notify,
    shutdown: CancellationToken,
}

struct Started {
    params: ParamStore,
    permissions: Arc<dyn PermissionLookup>,
    client: HttpClient,
}
#[derive(Default)]
struct Runs {
    closed: bool,
    entries: BTreeMap<Id, Control>,
}
struct Control {
    owner: StreamOwner,
    cancellation: CancellationToken,
}

struct Registration<'a> {
    service: &'a AiService,
    id: Id,
    cancellation: CancellationToken,
    registered: bool,
    trace_id: &'a str,
    start: Instant,
    model: String,
    input_bytes: usize,
    output_bytes: usize,
    terminal: &'static str,
    code: Option<ErrorCode>,
    status: Option<u16>,
}

impl Registration<'_> {
    fn release(&mut self) -> Result<(), AppError> {
        if self.registered {
            // 中毒状态只用于移除本次登记、释放资源；普通操作仍返回内部错误。
            let (mut runs, poisoned) = match self.service.runs.lock() {
                Ok(runs) => (runs, false),
                Err(error) => (error.into_inner(), true),
            };
            runs.entries.remove(&self.id);
            self.registered = false;
            self.service.changed.notify_waiters();
            if poisoned {
                return Err(AppError::new(INTERNAL_UNEXPECTED));
            }
        }
        Ok(())
    }
}

impl Drop for Registration<'_> {
    fn drop(&mut self) {
        self.cancellation.cancel();
        if let Err(error) = self.release() {
            self.terminal = "failed";
            self.code = Some(error.code());
        }
        tracing::info!(
            event = "ai.stream.ended", run_id = %self.id, trace_id = self.trace_id,
            model = self.model, duration_ms = self.start.elapsed().as_millis() as u64,
            terminal = self.terminal, input_bytes = self.input_bytes, output_bytes = self.output_bytes,
            code = self.code.map(ErrorCode::as_str), status = self.status,
        );
    }
}

impl Module for AiService {
    fn declaration(&self) -> &ModuleDeclaration {
        &DECLARATION
    }
    fn start<'a>(&'a self, context: ModuleContext<'a>) -> ModuleFuture<'a> {
        Box::pin(async move {
            let permissions = context.extensions.identity().permission_lookup.clone();
            self.started
                .set(Started {
                    params: context.params.clone(),
                    permissions,
                    client: HttpClient::new(),
                })
                .map_err(|_| AppError::new(INTERNAL_UNEXPECTED))
        })
    }
    fn stop(&self) -> ModuleFuture<'_> {
        Box::pin(async move {
            {
                // 即使登记锁中毒也先取消已有请求，再明确报告内部错误。
                let (mut runs, poisoned) = match self.runs.lock() {
                    Ok(runs) => (runs, false),
                    Err(error) => (error.into_inner(), true),
                };
                runs.closed = true;
                self.shutdown.cancel();
                for control in runs.entries.values() {
                    control.cancellation.cancel();
                }
                if poisoned {
                    return Err(AppError::new(INTERNAL_UNEXPECTED));
                }
            }
            timeout(Duration::from_secs(SHUTDOWN_TIMEOUT_SECONDS), async {
                loop {
                    let changed = self.changed.notified();
                    tokio::pin!(changed);
                    changed.as_mut().enable();
                    if self.lock_runs()?.entries.is_empty() {
                        break Ok(());
                    }
                    changed.await;
                }
            })
            .await
            .map_err(|_| AppError::new(SHUTDOWN_TIMEOUT))?
        })
    }
}

impl AiService {
    /// 构造时不读取代理或系统证书；bool 表示本次目标是否为精确回环地址。
    pub fn new(
        account: Arc<AccountService>,
        proxy: Arc<dyn Fn(bool) -> Result<ProxySnapshot, AppError> + Send + Sync>,
    ) -> Self {
        Self {
            account,
            proxy,
            started: OnceLock::new(),
            runs: Mutex::new(Runs::default()),
            changed: Notify::new(),
            shutdown: CancellationToken::new(),
        }
    }

    fn lock_runs(&self) -> Result<MutexGuard<'_, Runs>, AppError> {
        self.runs
            .lock()
            .map_err(|_| AppError::new(INTERNAL_UNEXPECTED))
    }

    fn register<'a>(
        &'a self,
        execution: &'a ExecutionContext,
        scope: &str,
        id: Id,
    ) -> Result<Registration<'a>, AppError> {
        let mut runs = self.lock_runs()?;
        if runs.closed {
            return Err(AppError::new(STREAM_CLOSED));
        }
        if runs.entries.contains_key(&id) {
            return Err(AppError::new(CONFLICT));
        }
        if runs.entries.len() == MAX_ACTIVE_REQUESTS {
            return Err(AppError::new(BUSY));
        }
        let cancellation = CancellationToken::new();
        runs.entries.insert(
            id,
            Control {
                owner: StreamOwner {
                    actor: execution.actor,
                    scope: scope.into(),
                },
                cancellation: cancellation.clone(),
            },
        );
        Ok(Registration {
            service: self,
            id,
            cancellation,
            registered: true,
            trace_id: &execution.trace_id,
            start: Instant::now(),
            model: String::new(),
            input_bytes: 0,
            output_bytes: 0,
            terminal: "cancelled",
            code: Some(CANCELLED),
            status: None,
        })
    }

    pub fn cancel(&self, owner: &StreamOwner, input: AiCancelInput) -> Result<(), AppError> {
        if let Some(control) = self.lock_runs()?.entries.get(&input.run_id) {
            if &control.owner != owner {
                return Err(AppError::new(STREAM_FORBIDDEN));
            }
            control.cancellation.cancel();
        }
        Ok(())
    }

    pub async fn chat(
        &self,
        execution: &ExecutionContext,
        scope: &str,
        input: AiChatInput,
        streams: &StreamRegistry,
        sink: impl StreamSink<AiStreamData> + 'static,
    ) -> Result<(), AppError> {
        self.run(execution, scope, input, streams, sink, false)
            .await
            .map(|_| ())
    }

    pub async fn test_connection(
        &self,
        execution: &ExecutionContext,
    ) -> Result<AiConnectionTest, AppError> {
        struct Discard;
        impl StreamSink<AiStreamData> for Discard {
            fn send(&self, _: StreamEvent<AiStreamData>) -> Result<(), AppError> {
                Ok(())
            }
        }
        self.run(
            execution,
            "ai.service.test",
            AiChatInput {
                run_id: Id::new(),
                messages: vec![AiMessage {
                    id: Id::new(),
                    role: AiRole::User,
                    parts: vec![AiPart::Text {
                        part_id: Id::new(),
                        text: "Reply OK.".into(),
                    }],
                }],
            },
            &StreamRegistry::default(),
            Discard,
            true,
        )
        .await
    }

    async fn run(
        &self,
        execution: &ExecutionContext,
        scope: &str,
        input: AiChatInput,
        streams: &StreamRegistry,
        sink: impl StreamSink<AiStreamData> + 'static,
        testing: bool,
    ) -> Result<AiConnectionTest, AppError> {
        let mut registration = self.register(execution, scope, input.run_id)?;
        let started = self.started.get().ok_or_else(|| {
            registration.terminal = "failed";
            registration.code = Some(INTERNAL_UNEXPECTED);
            AppError::new(INTERNAL_UNEXPECTED)
        })?;
        let prepared = tokio::select! {
            biased;
            _ = registration.cancellation.cancelled() => Err(AppError::new(CANCELLED)),
            result = timeout(Duration::from_secs(PREPARE_TIMEOUT_SECONDS), async {
                let messages = client::messages(&input.messages)?;
                self.authorize(started, execution.actor, testing).await?;
                let config = Config::read(&started.params, testing).await?;
                let proxy = (self.proxy)(config.exact_loopback)?;
                let body = client::body(&config, messages, testing)?;
                self.authorize(started, execution.actor, testing).await?;
                Ok((config, proxy, body))
            }) => result.unwrap_or_else(|_| Err(AppError::new(TIMEOUT))),
        };
        let (config, proxy, body) = match prepared {
            Ok(prepared) => prepared,
            Err(error) => {
                registration.terminal = if error.code() == CANCELLED {
                    "cancelled"
                } else {
                    "failed"
                };
                registration.code = Some(error.code());
                return Err(error);
            }
        };
        registration.model.clone_from(&config.model);
        registration.input_bytes = body.len();
        let gate = Arc::new(DeliveryGate {
            sink: Box::new(sink),
            lost: AtomicBool::new(false),
        });
        let stream = streams
            .open(
                StreamOwner {
                    actor: execution.actor,
                    scope: scope.into(),
                },
                gate.clone(),
            )
            .inspect_err(|error| {
                registration.terminal = if error.code() == RESULT_UNKNOWN {
                    "unknown"
                } else {
                    "failed"
                };
                registration.code = Some(error.code());
            })?;
        let mut delivery = Delivery {
            service: self,
            started,
            actor: execution.actor,
            testing,
            stream: &stream,
            run_id: input.run_id,
            message_id: Id::new(),
            deltas: 0,
            pending: None,
        };
        let request_start = Instant::now();
        let deadline = request_start + config.total;
        let end = {
            let operation = async {
                delivery
                    .send(AiUpdate::MessageStart {
                        model: config.model.clone(),
                        trace_id: execution.trace_id.clone(),
                        total_timeout_ms: config.total.as_millis() as u32,
                    })
                    .await?;
                self.authorize(started, execution.actor, testing).await?;
                let request = started.client.request(&config, &proxy, body)?;
                pipeline(
                    request,
                    &mut delivery,
                    &mut registration.output_bytes,
                    &mut registration.status,
                )
                .await
            };
            tokio::pin!(operation);
            tokio::select! {
                biased;
                result = &mut operation => match result { Ok(summary) => End::Succeeded(summary), Err(end) => end },
                _ = registration.cancellation.cancelled() => End::Cancelled,
                _ = stream.cancellation.cancelled() => End::Cancelled,
                _ = sleep_until(deadline) => End::Unknown("ai.stream.timeout"),
                error = self.monitor(started, execution.actor, testing) => End::Failed(error),
            }
            // operation 在本作用域末尾被丢弃：Send/Response/解析器先于终态释放。
        };
        // 终态是屏障。失去观察端/关闭/失去授权时不再发布缓冲正文。
        let mut end = end;
        // 收尾期间 future 也可能被丢弃；日志保留 worker 已经决定的结果。
        registration.terminal = match &end {
            End::Succeeded(_) => "succeeded",
            End::Failed(_) => "failed",
            End::Cancelled => "cancelled",
            End::Unknown(_) => "unknown",
        };
        registration.code = match &end {
            End::Succeeded(_) => None,
            End::Failed(error) => Some(error.code()),
            End::Cancelled => Some(CANCELLED),
            End::Unknown(_) => Some(RESULT_UNKNOWN),
        };
        if !stream.cancellation.is_cancelled()
            && !self.shutdown.is_cancelled()
            && !gate.lost.load(Ordering::SeqCst)
        {
            let flushed = tokio::select! {
                biased;
                _ = self.shutdown.cancelled() => Ok(()),
                result = timeout(Duration::from_secs(SHUTDOWN_TIMEOUT_SECONDS), delivery.flush()) => result.unwrap_or(Err(End::Unknown("ai.stream.timeout"))),
            };
            if let Err(error) = flushed
                && matches!(end, End::Succeeded(_))
            {
                end = error;
            }
        }
        let message_id = delivery.message_id;
        drop(delivery);
        drop(stream);
        if let Err(error) = registration.release() {
            end = End::Failed(error);
        }
        let (terminal, result) = match end {
            End::Succeeded(summary) => {
                registration.terminal = "succeeded";
                registration.code = None;
                (
                    StreamEvent::Succeeded {
                        data: Some(AiStreamData {
                            run_id: input.run_id,
                            message_id,
                            update: AiUpdate::Finish {
                                finish_reason: summary.reason,
                                usage: summary.usage.clone(),
                            },
                        }),
                    },
                    Ok(AiConnectionTest {
                        model: config.model,
                        duration_ms: request_start.elapsed().as_millis() as u32,
                        usage: summary.usage,
                    }),
                )
            }
            End::Failed(error) => {
                registration.terminal = "failed";
                registration.code = Some(error.code());
                let mut params = BTreeMap::new();
                if error.code() == PERMISSION_DENIED {
                    params.insert("permission".into(), "ai.chat.use".into());
                }
                if let Some(status) = registration.status.filter(|status| *status != 200) {
                    params.insert("status".into(), status.to_string());
                }
                (
                    StreamEvent::Failed {
                        code: error.code().as_str().into(),
                        params,
                    },
                    Err(error),
                )
            }
            End::Cancelled => {
                registration.terminal = "cancelled";
                registration.code = Some(CANCELLED);
                (StreamEvent::Cancelled, Err(AppError::new(CANCELLED)))
            }
            End::Unknown(reason) => {
                registration.terminal = "unknown";
                registration.code = Some(RESULT_UNKNOWN);
                (
                    StreamEvent::Unknown {
                        reason: reason.into(),
                    },
                    Err(AppError::new(RESULT_UNKNOWN)),
                )
            }
        };
        if gate.lost.load(Ordering::SeqCst) || gate.sink.send(terminal).is_err() {
            registration.terminal = "unknown";
            registration.code = Some(RESULT_UNKNOWN);
            return Err(AppError::new(RESULT_UNKNOWN));
        }
        result
    }

    async fn authorize(
        &self,
        started: &Started,
        actor: Actor,
        testing: bool,
    ) -> Result<(), AppError> {
        for key in if testing {
            &["ai.service.manage", "ai.chat.use"][..]
        } else {
            &["ai.chat.use"][..]
        } {
            if !started.permissions.has_permission(actor, key).await? {
                return Err(AppError::new(PERMISSION_DENIED).with_param("permission", *key));
            }
        }
        self.active(actor, || Ok(())).await
    }

    async fn active<T: Send>(
        &self,
        actor: Actor,
        work: impl FnOnce() -> Result<T, AppError> + Send,
    ) -> Result<T, AppError> {
        let Actor::User(user) = actor else {
            return Err(AppError::new(AUTH_REQUIRED));
        };
        self.account
            .with_active_user(user, work)
            .await?
            .ok_or_else(|| AppError::new(AUTH_REQUIRED))
    }

    async fn monitor(&self, started: &Started, actor: Actor, testing: bool) -> AppError {
        let mut timer = interval(Duration::from_secs(1));
        timer.tick().await;
        loop {
            timer.tick().await;
            if let Err(error) = self.authorize(started, actor, testing).await {
                return error;
            }
        }
    }
}

// framework 的观察取消可以在 delta 内收敛为 Cancelled。AI 的执行终态必须
// 晚于 HTTP 释放，因此只让 worker 在清理后向同一个 sink 提交唯一终态。
struct DeliveryGate {
    sink: Box<dyn StreamSink<AiStreamData>>,
    lost: AtomicBool,
}
impl StreamSink<AiStreamData> for Arc<DeliveryGate> {
    fn send(&self, event: StreamEvent<AiStreamData>) -> Result<(), AppError> {
        if matches!(event, StreamEvent::Cancelled) {
            return Ok(());
        }
        self.sink.send(event).map_err(|_| {
            self.lost.store(true, Ordering::SeqCst);
            AppError::new(RESULT_UNKNOWN)
        })
    }
}

struct Summary {
    reason: AiFinishReason,
    usage: Option<AiUsage>,
}
enum End {
    Succeeded(Summary),
    Failed(AppError),
    Cancelled,
    Unknown(&'static str),
}
impl From<AppError> for End {
    fn from(error: AppError) -> Self {
        Self::Failed(error)
    }
}

struct Pending {
    id: Id,
    kind: AiPartKind,
    text: String,
    since: Instant,
}
struct Delivery<'a> {
    service: &'a AiService,
    started: &'a Started,
    actor: Actor,
    testing: bool,
    stream: &'a Stream<AiStreamData>,
    run_id: Id,
    message_id: Id,
    deltas: usize,
    pending: Option<Pending>,
}

impl Delivery<'_> {
    async fn send(&mut self, update: AiUpdate) -> Result<(), End> {
        if self.stream.cancellation.is_cancelled() {
            return Err(End::Cancelled);
        }
        if self.deltas == MAX_STREAM_DELTAS {
            return Err(AppError::new(LIMIT).into());
        }
        self.service
            .authorize(self.started, self.actor, self.testing)
            .await?;
        self.service
            .active(self.actor, || {
                self.stream.delta(AiStreamData {
                    run_id: self.run_id,
                    message_id: self.message_id,
                    update,
                })
            })
            .await?;
        if self.stream.cancellation.is_cancelled() {
            return Err(End::Cancelled);
        }
        self.deltas += 1;
        Ok(())
    }
    async fn flush(&mut self) -> Result<(), End> {
        if let Some(pending) = self.pending.take() {
            self.send(match pending.kind {
                AiPartKind::Text => AiUpdate::TextDelta {
                    part_id: pending.id,
                    text: pending.text,
                },
                AiPartKind::Reasoning => AiUpdate::ReasoningDelta {
                    part_id: pending.id,
                    text: pending.text,
                },
            })
            .await?;
        }
        Ok(())
    }
    async fn update(&mut self, update: AiUpdate) -> Result<(), End> {
        let (id, kind, text) = match update {
            AiUpdate::TextDelta { part_id, text } => (part_id, AiPartKind::Text, text),
            AiUpdate::ReasoningDelta { part_id, text } => (part_id, AiPartKind::Reasoning, text),
            other => {
                self.flush().await?;
                return self.send(other).await;
            }
        };
        let mut remaining = text.as_str();
        while !remaining.is_empty() {
            let pending = self.pending.get_or_insert_with(|| Pending {
                id,
                kind,
                text: String::new(),
                since: Instant::now(),
            });
            let room = COALESCE_BYTES - pending.text.len();
            let mut end = room.min(remaining.len());
            while !remaining.is_char_boundary(end) {
                end -= 1;
            }
            pending.text.push_str(&remaining[..end]);
            remaining = &remaining[end..];
            if !remaining.is_empty()
                || pending.text.len() == COALESCE_BYTES
                || pending.since.elapsed() >= Duration::from_millis(COALESCE_MS)
            {
                self.flush().await?;
            }
        }
        Ok(())
    }
}

async fn pipeline(
    request: reqwest::RequestBuilder,
    delivery: &mut Delivery<'_>,
    output_bytes: &mut usize,
    status: &mut Option<u16>,
) -> Result<Summary, End> {
    let mut response = request.send().await.map_err(|error| {
        if error.is_connect() {
            End::Failed(AppError::new(if error.is_timeout() {
                TIMEOUT
            } else {
                CONNECT_FAILED
            }))
        } else if error.is_timeout() {
            End::Unknown("ai.stream.timeout")
        } else {
            End::Unknown("ai.stream.interrupted")
        }
    })?;
    *status = Some(response.status().as_u16());
    client::response(&response)?;
    let mut decoder = Decoder::default();
    let mut mapping = Mapping::default();
    loop {
        if delivery
            .pending
            .as_ref()
            .is_some_and(|pending| pending.since.elapsed() >= Duration::from_millis(COALESCE_MS))
        {
            delivery.flush().await?;
        }
        let flush_at = delivery
            .pending
            .as_ref()
            .map(|p| p.since + Duration::from_millis(COALESCE_MS));
        let next = response.chunk();
        tokio::pin!(next);
        let chunk = loop {
            tokio::select! {
                biased;
                chunk = &mut next => break chunk,
                _ = async { if let Some(at) = flush_at { sleep_until(at).await } else { std::future::pending().await } }, if delivery.pending.is_some() => delivery.flush().await?,
            }
        };
        let Some(chunk) = chunk.map_err(|error| {
            if error.is_timeout() {
                End::Unknown("ai.stream.timeout")
            } else {
                End::Unknown("ai.stream.interrupted")
            }
        })?
        else {
            return Err(End::Unknown("ai.stream.missingDone"));
        };
        *output_bytes += chunk.len();
        if *output_bytes > MAX_RESPONSE_BYTES {
            return Err(AppError::new(LIMIT).into());
        }
        let mut bytes = chunk.as_ref();
        while let Some(event) = decoder.next(&mut bytes)? {
            let mut updates = Vec::new();
            let done = mapping.event(event, &mut updates)?;
            for update in updates {
                delivery.update(update).await?;
            }
            if done {
                delivery.flush().await?;
                return match mapping.finish {
                    Some(reason) => Ok(Summary {
                        reason,
                        usage: mapping.usage,
                    }),
                    None => Err(End::Unknown("ai.stream.missingFinish")),
                };
            }
        }
    }
}

#[cfg(test)]
#[path = "tests/mod.rs"]
mod tests;
