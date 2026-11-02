use std::{
    collections::BTreeMap,
    sync::{
        Arc, Mutex,
        atomic::{AtomicUsize, Ordering},
    },
    time::Duration,
};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::{TcpListener, TcpStream},
    sync::Notify,
    task::{JoinHandle, JoinSet},
};
use tokio_util::sync::CancellationToken;

// 固定公开合成 CA（2026-10-19），不依赖运行中的测试容器。
// 仅保留公开的合成 CA，用于根解析与本机 HTTP 测试；不验证 TLS 握手或证书有效期。
pub(crate) const ROOT_CERT_PEM: &[u8] = b"-----BEGIN CERTIFICATE-----
MIIDLTCCAhWgAwIBAgIULJDiHxaPJUI3/AcRkocH+DG5z1owDQYJKoZIhvcNAQEL
BQAwHjEcMBoGA1UEAwwTZHVzaGFuLXNtdHAtdGVzdC1jYTAeFw0yNjEwMTkxMzQ2
NTJaFw0yNjEwMjExMzQ2NTJaMB4xHDAaBgNVBAMME2R1c2hhbi1zbXRwLXRlc3Qt
Y2EwggEiMA0GCSqGSIb3DQEBAQUAA4IBDwAwggEKAoIBAQC1mCxJpEpKZEWSsFvW
f9FXQwzUndvJ7e3W0Ahg7lvW5cr9jtbIeM+0bqctkW72+SdnmKhxmXLooIWAxAVf
wfmYzl+p0MFw9Lo9Ic+7PSaWxTw3MKwu21qAjEUeZD60Dnq3hIMa86G3/pS5FVu5
LUbugIX3HLsFMlf2OQT+CDM5JNkjKvJ6yM6wPp11WBMxdLqf0JCVTNSHvAyLvTMC
h7VgPGpADdxhHLGnaAIMUx3tioNS6M76hLZgM+m603BFUdKXu6oJszaF+PbOGt4k
oWPFtruDPoKYlx2R4p+gug7UiAIcUzfCUFWFGN79TWGrT8YTDNWVxxQ2SyN9mQzr
NAm/AgMBAAGjYzBhMB0GA1UdDgQWBBRNRCM4O/d+cjkNVT4h43YIQcq6qTAfBgNV
HSMEGDAWgBRNRCM4O/d+cjkNVT4h43YIQcq6qTAPBgNVHRMBAf8EBTADAQH/MA4G
A1UdDwEB/wQEAwIBBjANBgkqhkiG9w0BAQsFAAOCAQEAm4U0FQLZWPmutDbPcTds
4moctNYbgRPRG5QftD/1+hgn7Otpbk2X5oCbfBpF/WdYQs0b80XHEK933gSGrOjy
stlIPi0jJQe/+yplLPHUtOUxNTWu8hxuXA+zsaemWn29mXlHMzj76uzRiIWyWNjH
5usxhs/faQpPTt86wNxk9B2qPpglwgky7S6DS/c0GbQaQ51coy4XRVcv41ywXFQZ
cFLqKRUN88MD7N9K0wmS1Fys5DhhLwJqwAFOkS9kLJsdkrzdzS4+b0XZqldGH4kY
AYBP+Q14KMvCYHQhd4QPE8XWIcYP1LGmcddiG6UteiQFScu6L/tvcO0MhW+pJTEN
zA==
-----END CERTIFICATE-----
";

pub(crate) struct Request {
    pub path: String,
    pub headers: BTreeMap<String, String>,
    pub body: serde_json::Value,
}

/// 只接收本机 CONNECT 并返回拒绝；返回请求头供认证边界断言，不写日志。
pub(crate) async fn rejecting_proxy() -> (String, JoinHandle<String>) {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let endpoint = format!("http://{}", listener.local_addr().unwrap());
    let task = tokio::spawn(async move {
        tokio::time::timeout(Duration::from_secs(5), async {
            let (mut stream, _) = listener.accept().await.unwrap();
            let mut bytes = Vec::new();
            let mut byte = [0];
            while !bytes.ends_with(b"\r\n\r\n") {
                stream.read_exact(&mut byte).await.unwrap();
                bytes.push(byte[0]);
                assert!(bytes.len() <= 16384);
            }
            stream.write_all(b"HTTP/1.1 407 Proxy Authentication Required\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").await.unwrap();
            String::from_utf8(bytes).unwrap()
        }).await.unwrap()
    });
    (endpoint, task)
}

#[derive(Clone)]
pub(crate) enum Step {
    Bytes(Vec<u8>),
    Wait(Duration),
}

pub(crate) struct Server {
    pub url: String,
    pub requests: Arc<Mutex<Vec<Request>>>,
    pub closed: Arc<AtomicUsize>,
    received: Arc<Notify>,
    cancellation: CancellationToken,
    task: Option<JoinHandle<()>>,
}

impl Server {
    pub async fn sse(data: impl Into<Vec<u8>>) -> Self {
        Self::new(
            200,
            "Content-Type: text/event-stream\r\n",
            vec![Step::Bytes(data.into())],
            true,
        )
        .await
    }
    pub async fn new(status: u16, headers: &str, steps: Vec<Step>, end: bool) -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}/v1", listener.local_addr().unwrap());
        let requests = Arc::new(Mutex::new(Vec::new()));
        let closed = Arc::new(AtomicUsize::new(0));
        let received = Arc::new(Notify::new());
        let cancellation = CancellationToken::new();
        let task = {
            let requests = requests.clone();
            let closed = closed.clone();
            let received = received.clone();
            let cancellation = cancellation.clone();
            let headers = format!(
                "HTTP/1.1 {status} Test\r\n{headers}Transfer-Encoding: chunked\r\nConnection: close\r\n\r\n"
            );
            tokio::spawn(async move {
                let mut connections = JoinSet::new();
                loop {
                    tokio::select! {
                        _ = cancellation.cancelled() => break,
                        connection = listener.accept() => {
                            let (stream, _) = connection.unwrap();
                            let requests = requests.clone(); let received = received.clone();
                            let closed = closed.clone(); let headers = headers.clone();
                            let steps = steps.clone(); let token = cancellation.clone();
                            connections.spawn(async move {
                                tokio::select! {
                                    _ = token.cancelled() => {},
                                    _ = serve(stream, &requests, &received, &headers, steps, end) => {},
                                }
                                closed.fetch_add(1, Ordering::SeqCst);
                            });
                        }
                        result = connections.join_next(), if !connections.is_empty() => { result.unwrap().unwrap(); }
                    }
                }
                while let Some(result) = connections.join_next().await {
                    result.unwrap();
                }
            })
        };
        Self {
            url,
            requests,
            closed,
            received,
            cancellation,
            task: Some(task),
        }
    }
    pub async fn received(&self, count: usize) {
        tokio::time::timeout(Duration::from_secs(5), async {
            loop {
                let notified = self.received.notified();
                if self.requests.lock().unwrap().len() >= count {
                    break;
                }
                notified.await;
            }
        })
        .await
        .unwrap();
    }
    pub async fn released(&self, count: usize) {
        tokio::time::timeout(Duration::from_secs(2), async {
            while self.closed.load(Ordering::SeqCst) < count {
                tokio::time::sleep(Duration::from_millis(5)).await;
            }
        })
        .await
        .unwrap();
    }
    pub async fn stop(mut self) {
        self.cancellation.cancel();
        self.task.take().unwrap().await.unwrap();
    }
}

impl Drop for Server {
    fn drop(&mut self) {
        self.cancellation.cancel();
        if let Some(task) = self.task.take() {
            task.abort();
        }
    }
}

async fn serve(
    mut stream: TcpStream,
    requests: &Mutex<Vec<Request>>,
    received: &Notify,
    headers: &str,
    steps: Vec<Step>,
    end: bool,
) {
    let mut bytes = Vec::new();
    let mut buffer = [0; 4096];
    // 合成 TLS 握手静默端点：不解析或回显握手数据，用于连接超时分类。
    if headers.starts_with("HTTP/1.1 0 ") {
        while matches!(stream.read(&mut buffer).await, Ok(count) if count > 0) {}
        return;
    }
    let split = loop {
        let Ok(count) = stream.read(&mut buffer).await else {
            return;
        };
        if count == 0 {
            return;
        }
        bytes.extend_from_slice(&buffer[..count]);
        if let Some(index) = bytes.windows(4).position(|v| v == b"\r\n\r\n") {
            break index + 4;
        }
        assert!(bytes.len() < 16384);
    };
    let raw = String::from_utf8(bytes[..split].to_vec()).unwrap();
    let mut lines = raw.lines();
    let path = lines.next().unwrap().to_owned();
    let parsed: BTreeMap<String, String> = lines
        .filter_map(|line| line.split_once(':'))
        .map(|(key, value)| (key.to_ascii_lowercase(), value.trim().into()))
        .collect();
    let length: usize = parsed["content-length"].parse().unwrap();
    while bytes.len() < split + length {
        let Ok(count) = stream.read(&mut buffer).await else {
            return;
        };
        if count == 0 {
            return;
        }
        bytes.extend_from_slice(&buffer[..count]);
    }
    let body = serde_json::from_slice(&bytes[split..split + length]).unwrap();
    requests.lock().unwrap().push(Request {
        path,
        headers: parsed,
        body,
    });
    received.notify_one();
    if stream.write_all(headers.as_bytes()).await.is_err() {
        return;
    }
    for step in steps {
        match step {
            Step::Bytes(bytes) => {
                if stream
                    .write_all(format!("{:x}\r\n", bytes.len()).as_bytes())
                    .await
                    .is_err()
                    || stream.write_all(&bytes).await.is_err()
                    || stream.write_all(b"\r\n").await.is_err()
                {
                    return;
                }
            }
            Step::Wait(duration) => {
                tokio::select! {
                    _ = tokio::time::sleep(duration) => {},
                    _ = stream.read(&mut buffer) => return,
                }
            }
        }
    }
    if end {
        if stream.write_all(b"0\r\n\r\n").await.is_err() {
            return;
        }
        let _ = stream.read(&mut buffer).await;
    }
}
