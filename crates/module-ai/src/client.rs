use std::{collections::BTreeSet, io::Write, net::SocketAddr, sync::Mutex, time::Duration};

use reqwest::{
    Client, Url,
    header::{AUTHORIZATION, CONTENT_ENCODING, CONTENT_TYPE, HeaderValue},
};
use secrecy::ExposeSecret;
use serde::Serialize;
use serde_json::{Map, Value};
use tenon_framework::{
    error::{AppError, INPUT_INVALID, INTERNAL_UNEXPECTED},
    id::Id,
    network::{ProxySnapshot, is_exact_loopback},
    param::ParamStore,
};

use crate::{
    AUTH_FAILED, AiFinishReason, AiMessage, AiPart, AiPartKind, AiRole, AiUpdate, AiUsage,
    CONNECT_FAILED, FILTERED, HTTP_REJECTED, INVALID_CONFIG, LIMIT, MAX_MESSAGES,
    MAX_PARTS_PER_MESSAGE, MAX_REQUEST_BYTES, NOT_CONFIGURED, PROTOCOL, RATE_LIMITED,
    REDIRECT_REJECTED, RESPONSE_REJECTED, TEST_TIMEOUT_SECONDS, UNAVAILABLE, UNSUPPORTED,
    sse::Event,
};

pub(crate) struct Config {
    pub endpoint: Url,
    pub exact_loopback: bool,
    pub model: String,
    pub authorization: Option<HeaderValue>,
    pub connect: Duration,
    pub idle: Duration,
    pub total: Duration,
    pub include_usage: bool,
}

fn invalid(field: &'static str) -> AppError {
    AppError::new(INVALID_CONFIG).with_param("field", field)
}

impl Config {
    pub async fn read(params: &ParamStore, testing: bool) -> Result<Self, AppError> {
        let base = params.text("ai.base_url").await?;
        let model = params.text("ai.model").await?;
        for (field, value) in [("base_url", &base), ("model", &model)] {
            if value.is_empty() {
                return Err(AppError::new(NOT_CONFIGURED).with_param("field", field));
            }
        }
        let endpoint = endpoint(&base)?;
        if !model
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"._:/-".contains(&b))
        {
            return Err(invalid("ai.model"));
        }
        let connect = Duration::from_secs(params.int("ai.connect_timeout_seconds").await? as u64);
        let idle = Duration::from_secs(params.int("ai.idle_timeout_seconds").await? as u64);
        let total = Duration::from_secs(params.int("ai.total_timeout_seconds").await? as u64);
        if total < connect || total < idle {
            return Err(invalid("ai.total_timeout_seconds"));
        }
        let include_usage = params.bool("ai.include_usage").await?;
        // ParamStore 自己执行 secret_set 门禁；没有 ai 专用环境回退。
        let authorization = params
            .secret("ai.api_key")
            .await?
            .map(|secret| authorization(secret.expose_secret()))
            .transpose()?;
        let total = if testing {
            total.min(Duration::from_secs(TEST_TIMEOUT_SECONDS))
        } else {
            total
        };
        Ok(Self {
            endpoint,
            exact_loopback: is_exact_loopback(&base),
            model,
            authorization,
            connect: connect.min(total),
            idle: idle.min(total),
            total,
            include_usage,
        })
    }
}

pub(crate) fn endpoint(base: &str) -> Result<Url, AppError> {
    let error = || invalid("ai.base_url");
    if base.chars().any(|c| c.is_control() || c == '\\') || base.trim() != base {
        return Err(error());
    }
    let url = Url::parse(base).map_err(|_| error())?;
    if !matches!(url.scheme(), "https" | "http")
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
        || url.port_or_known_default().is_none_or(|port| port == 0)
    {
        return Err(error());
    }
    let (_, remainder) = base.split_once("://").ok_or_else(error)?;
    let authority = remainder.split('/').next().ok_or_else(error)?;
    if authority.contains('@') {
        return Err(error());
    }
    if url.scheme() == "http" {
        // 校验原始 authority，不能让 URL 的整数/缩写 IPv4 归一化放过伪回环。
        let host = if authority.starts_with('[') {
            authority
                .split_once(']')
                .map(|(host, _)| format!("{host}]"))
        } else {
            Some(authority.split(':').next().ok_or_else(error)?.to_owned())
        };
        if !matches!(host.as_deref(), Some("localhost" | "127.0.0.1" | "[::1]")) {
            return Err(error());
        }
    }
    Url::parse(&format!("{}/chat/completions", base.trim_end_matches('/'))).map_err(|_| error())
}

pub(crate) fn authorization(key: &str) -> Result<HeaderValue, AppError> {
    if key.is_empty() || key.chars().any(char::is_control) {
        return Err(invalid("ai.api_key"));
    }
    let mut header =
        HeaderValue::from_str(&format!("Bearer {key}")).map_err(|_| invalid("ai.api_key"))?;
    header.set_sensitive(true);
    Ok(header)
}

// 每轮按已保存的超时/代理快照构建连接器，不跨请求缓存代理秘密。
// 系统根在首次请求时加载，成功后复用；失败不缓存，不影响应用启动。
pub(crate) struct HttpClient {
    current: Mutex<Option<rustls::ClientConfig>>,
}

pub(crate) fn roots_from_der<'a>(
    certs: impl IntoIterator<Item = rustls::pki_types::CertificateDer<'a>>,
) -> Result<(rustls::RootCertStore, usize), AppError> {
    let mut roots = rustls::RootCertStore::empty();
    let (_, ignored) = roots.add_parsable_certificates(certs);
    if roots.is_empty() {
        return Err(AppError::new(CONNECT_FAILED));
    }
    Ok((roots, ignored))
}

impl HttpClient {
    pub fn new() -> Self {
        Self {
            current: Mutex::new(None),
        }
    }

    fn load_tls() -> Result<rustls::ClientConfig, AppError> {
        let (roots, ignored) = roots_from_der(rustls_native_certs::load_native_certs().certs)?;
        tracing::debug!(event = "ai.http.roots_loaded", ignored);
        Ok(
            rustls::ClientConfig::builder_with_provider(std::sync::Arc::new(
                rustls::crypto::ring::default_provider(),
            ))
            .with_safe_default_protocol_versions()
            .map_err(|_| AppError::new(CONNECT_FAILED))?
            .with_root_certificates(roots)
            .with_no_client_auth(),
        )
    }

    fn build(
        tls: &rustls::ClientConfig,
        connect: Duration,
        idle: Duration,
        proxy: &ProxySnapshot,
    ) -> Result<Client, AppError> {
        let mut builder = Client::builder()
            .tls_backend_preconfigured(tls.clone())
            .no_proxy()
            .redirect(reqwest::redirect::Policy::none())
            .retry(reqwest::retry::never())
            .http1_only()
            .pool_max_idle_per_host(0)
            .resolve_to_addrs(
                "localhost",
                &[
                    SocketAddr::from(([127, 0, 0, 1], 0)),
                    SocketAddr::from(([0, 0, 0, 0, 0, 0, 0, 1], 0)),
                ],
            )
            .connect_timeout(connect)
            .read_timeout(idle);
        if let ProxySnapshot::Manual {
            endpoint,
            credentials,
        } = proxy
        {
            let mut proxy =
                reqwest::Proxy::all(endpoint).map_err(|_| AppError::new(CONNECT_FAILED))?;
            if let Some(credentials) = credentials {
                proxy = proxy.basic_auth(
                    credentials.username.expose_secret(),
                    credentials.password.expose_secret(),
                );
            }
            builder = builder.proxy(proxy);
        }
        builder.build().map_err(|_| AppError::new(CONNECT_FAILED))
    }

    pub fn request(
        &self,
        config: &Config,
        proxy: &ProxySnapshot,
        body: Vec<u8>,
    ) -> Result<reqwest::RequestBuilder, AppError> {
        let client = {
            let mut cached = self
                .current
                .lock()
                .map_err(|_| AppError::new(INTERNAL_UNEXPECTED))?;
            let tls = match cached.as_ref() {
                Some(tls) => tls,
                None => {
                    let tls = Self::load_tls()?;
                    cached.insert(tls)
                }
            };
            Self::build(tls, config.connect, config.idle, proxy)?
        };
        let request = client
            .post(config.endpoint.clone())
            .header(CONTENT_TYPE, "application/json")
            .header("Accept", "text/event-stream")
            .header("Accept-Encoding", "identity")
            .body(body);
        Ok(match &config.authorization {
            Some(header) => request.header(AUTHORIZATION, header.clone()),
            None => request,
        })
    }
}

#[derive(Serialize)]
pub(crate) struct RequestMessage {
    role: AiRole,
    content: String,
}

pub(crate) fn messages(messages: &[AiMessage]) -> Result<Vec<RequestMessage>, AppError> {
    let invalid = || AppError::new(INPUT_INVALID).with_param("path", "messages");
    if messages.is_empty()
        || messages.len() > MAX_MESSAGES
        || messages.last().is_none_or(|m| m.role != AiRole::User)
    {
        return Err(invalid());
    }
    let mut ids = BTreeSet::new();
    let mut bytes = 0;
    messages
        .iter()
        .enumerate()
        .map(|(index, message)| {
            if !ids.insert(message.id)
                || (message.role == AiRole::System && index != 0)
                || message.parts.is_empty()
                || message.parts.len() > MAX_PARTS_PER_MESSAGE
            {
                return Err(invalid());
            }
            let mut part_ids = BTreeSet::new();
            let mut content = String::new();
            for part in &message.parts {
                let id = match part {
                    AiPart::Text { part_id, text } => {
                        bytes += text.len();
                        if bytes > MAX_REQUEST_BYTES {
                            return Err(AppError::new(LIMIT));
                        }
                        content.push_str(text);
                        part_id
                    }
                    AiPart::Reasoning { part_id, .. } if message.role == AiRole::Assistant => {
                        part_id
                    }
                    AiPart::Reasoning { .. } => return Err(invalid()),
                };
                if !part_ids.insert(*id) {
                    return Err(invalid());
                }
            }
            if content.is_empty() {
                return Err(invalid());
            }
            Ok(RequestMessage {
                role: message.role,
                content,
            })
        })
        .collect()
}

pub(crate) fn body(
    config: &Config,
    messages: Vec<RequestMessage>,
    testing: bool,
) -> Result<Vec<u8>, AppError> {
    #[derive(Serialize)]
    struct Request<'a> {
        model: &'a str,
        messages: Vec<RequestMessage>,
        stream: bool,
        n: u8,
        #[serde(skip_serializing_if = "Option::is_none")]
        stream_options: Option<StreamOptions>,
        #[serde(skip_serializing_if = "Option::is_none")]
        max_tokens: Option<u8>,
    }
    #[derive(Serialize)]
    struct StreamOptions {
        include_usage: bool,
    }
    struct Bounded(Vec<u8>);
    impl Write for Bounded {
        fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
            if self.0.len() + bytes.len() > MAX_REQUEST_BYTES {
                return Err(std::io::Error::other("request limit"));
            }
            self.0.extend_from_slice(bytes);
            Ok(bytes.len())
        }
        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }
    let mut writer = Bounded(Vec::new());
    serde_json::to_writer(
        &mut writer,
        &Request {
            model: &config.model,
            messages,
            stream: true,
            n: 1,
            stream_options: config.include_usage.then_some(StreamOptions {
                include_usage: true,
            }),
            max_tokens: testing.then_some(1),
        },
    )
    .map_err(|_| AppError::new(LIMIT))?;
    Ok(writer.0)
}

pub(crate) fn response(response: &reqwest::Response) -> Result<(), AppError> {
    let status = response.status().as_u16();
    let code = match status {
        200 => None,
        300..=399 => Some(REDIRECT_REJECTED),
        401 | 403 => Some(AUTH_FAILED),
        429 => Some(RATE_LIMITED),
        500..=599 => Some(UNAVAILABLE),
        _ => Some(HTTP_REJECTED),
    };
    if let Some(code) = code {
        return Err(AppError::new(code).with_param("status", status.to_string()));
    }
    let valid_type = response
        .headers()
        .get(CONTENT_TYPE)
        .and_then(|h| h.to_str().ok())
        .is_some_and(|value| {
            value
                .split(';')
                .next()
                .is_some_and(|mime| mime.trim().eq_ignore_ascii_case("text/event-stream"))
        });
    if !valid_type
        || response
            .headers()
            .get_all(CONTENT_ENCODING)
            .iter()
            .any(|h| !h.as_bytes().eq_ignore_ascii_case(b"identity"))
    {
        return Err(AppError::new(PROTOCOL));
    }
    Ok(())
}

#[derive(Default)]
pub(crate) struct Mapping {
    part: Option<(Id, AiPartKind)>,
    pub usage: Option<AiUsage>,
    pub finish: Option<AiFinishReason>,
}

impl Mapping {
    // 返回 true 表示准确收到 DONE；调用方立刻释放响应，不等待 EOF。
    pub fn event(&mut self, event: Event, updates: &mut Vec<AiUpdate>) -> Result<bool, AppError> {
        if event.event == "error" {
            return Err(AppError::new(RESPONSE_REJECTED));
        }
        if event.event != "message" {
            return Err(AppError::new(PROTOCOL));
        }
        if event.data.is_empty() {
            return Ok(false);
        }
        if event.data == "[DONE]" {
            return Ok(true);
        }
        let value: Value =
            serde_json::from_str(&event.data).map_err(|_| AppError::new(PROTOCOL))?;
        let object = value.as_object().ok_or_else(protocol)?;
        if object.contains_key("error") {
            return Err(AppError::new(RESPONSE_REJECTED));
        }
        let choices = object
            .get("choices")
            .and_then(Value::as_array)
            .ok_or_else(protocol)?;
        if choices.len() > 1 {
            return Err(protocol());
        }
        let mut finish = None;
        if let Some(choice) = choices.first() {
            let choice = choice.as_object().ok_or_else(protocol)?;
            if choice.get("index").and_then(Value::as_u64) != Some(0) {
                return Err(protocol());
            }
            match choice.get("delta") {
                Some(Value::Object(delta)) => {
                    if text(delta, "role")?
                        .is_some_and(|role| !role.is_empty() && role != "assistant")
                    {
                        return Err(protocol());
                    }
                    for key in ["tool_calls", "function_call", "reasoning", "reasoning_text"] {
                        if delta.get(key).is_some_and(nonempty) {
                            return Err(AppError::new(UNSUPPORTED));
                        }
                    }
                    for (field, kind) in [
                        ("reasoning_content", AiPartKind::Reasoning),
                        ("content", AiPartKind::Text),
                    ] {
                        if let Some(text) = text(delta, field)?.filter(|s| !s.is_empty()) {
                            if self.finish.is_some() {
                                return Err(protocol());
                            }
                            self.content(kind, text, updates);
                        }
                    }
                }
                None | Some(Value::Null) => {}
                Some(Value::String(s)) if s.is_empty() => {}
                _ => return Err(protocol()),
            }
            if let Some(reason) = text(choice, "finish_reason")? {
                if self.finish.is_some() {
                    return Err(protocol());
                }
                finish = Some(match reason {
                    "stop" => AiFinishReason::Stop,
                    "length" => AiFinishReason::Length,
                    "content_filter" => return Err(AppError::new(FILTERED)),
                    "" => return Err(protocol()),
                    _ => return Err(AppError::new(UNSUPPORTED)),
                });
            }
        }
        if let Some(value) = object.get("usage").filter(|v| !v.is_null()) {
            let usage = usage(value)?;
            self.usage = Some(usage.clone());
            updates.push(AiUpdate::Usage { usage });
        }
        if let Some(finish) = finish {
            if let Some((part_id, _)) = self.part.take() {
                updates.push(AiUpdate::PartEnd { part_id });
            }
            self.finish = Some(finish);
        }
        Ok(false)
    }

    fn content(&mut self, kind: AiPartKind, text: &str, updates: &mut Vec<AiUpdate>) {
        if let Some((part_id, current)) = self.part
            && current != kind
        {
            self.part = None;
            updates.push(AiUpdate::PartEnd { part_id });
        }
        let (part_id, _) = *self.part.get_or_insert_with(|| {
            let part_id = Id::new();
            updates.push(AiUpdate::PartStart { part_id, kind });
            (part_id, kind)
        });
        updates.push(match kind {
            AiPartKind::Text => AiUpdate::TextDelta {
                part_id,
                text: text.into(),
            },
            AiPartKind::Reasoning => AiUpdate::ReasoningDelta {
                part_id,
                text: text.into(),
            },
        });
    }
}

fn protocol() -> AppError {
    AppError::new(PROTOCOL)
}
fn text<'a>(value: &'a Map<String, Value>, key: &str) -> Result<Option<&'a str>, AppError> {
    match value.get(key) {
        None | Some(Value::Null) => Ok(None),
        Some(Value::String(s)) => Ok(Some(s)),
        _ => Err(protocol()),
    }
}
fn nonempty(value: &Value) -> bool {
    match value {
        Value::Null => false,
        Value::String(s) => !s.is_empty(),
        Value::Array(a) => !a.is_empty(),
        _ => true,
    }
}

fn usage(value: &Value) -> Result<AiUsage, AppError> {
    fn number(value: Option<&Value>) -> Result<Option<u64>, AppError> {
        match value {
            None | Some(Value::Null) => Ok(None),
            Some(value) => value
                .as_u64()
                .filter(|n| *n <= 9_007_199_254_740_991)
                .map(Some)
                .ok_or_else(protocol),
        }
    }
    fn detail(object: &Map<String, Value>, name: &str, key: &str) -> Result<Option<u64>, AppError> {
        match object.get(name) {
            None | Some(Value::Null) => Ok(None),
            Some(value) => number(value.as_object().ok_or_else(protocol)?.get(key)),
        }
    }
    let object = value.as_object().ok_or_else(protocol)?;
    Ok(AiUsage {
        input: number(object.get("prompt_tokens"))?,
        output: number(object.get("completion_tokens"))?,
        total_tokens: number(object.get("total_tokens"))?,
        reasoning: detail(object, "completion_tokens_details", "reasoning_tokens")?,
        cache_read: detail(object, "prompt_tokens_details", "cached_tokens")?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn poisoned_tls_cache_returns_internal_error() {
        let client = HttpClient::new();
        assert!(
            std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                let _guard = client.current.lock().unwrap();
                panic!("poison synthetic TLS cache");
            }))
            .is_err()
        );
        let config = Config {
            endpoint: endpoint("http://localhost:1").unwrap(),
            exact_loopback: true,
            model: "synthetic/model".into(),
            authorization: None,
            connect: Duration::from_secs(1),
            idle: Duration::from_secs(1),
            total: Duration::from_secs(5),
            include_usage: true,
        };
        assert_eq!(
            client
                .request(&config, &ProxySnapshot::Direct, vec![])
                .unwrap_err()
                .code(),
            INTERNAL_UNEXPECTED
        );
    }
}
