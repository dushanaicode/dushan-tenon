use crate::native::updater::{client_policy, redirect_allowed};
use std::{
    io::{Read, Write},
    net::{TcpListener, TcpStream},
    path::{Path, PathBuf},
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    },
    thread::JoinHandle,
    time::{Duration, Instant},
};
use tauri_plugin_updater::{Error, UpdaterBuilder, UpdaterExt};
use tenon_framework::network::ProxySnapshot;

const PAYLOAD: &[u8] =
    include_bytes!("../../../../vendor/tauri-plugin-updater/tests/fixtures/payload.bin");
const PUBLIC_KEY: &str =
    include_str!("../../../../vendor/tauri-plugin-updater/tests/fixtures/public-key.txt");
const SIGNATURE: &str =
    include_str!("../../../../vendor/tauri-plugin-updater/tests/fixtures/valid.sig");
const WRONG_KEY: &str =
    include_str!("../../../../vendor/tauri-plugin-updater/tests/fixtures/wrong-key.sig");

enum Response {
    Bytes(Vec<u8>),
    Chunked(usize),
}
struct Server {
    url: String,
    requests: Arc<Mutex<Vec<String>>>,
    stop: Arc<AtomicBool>,
    worker: Option<JoinHandle<()>>,
}
impl Drop for Server {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Release);
        let joined = self.worker.take().unwrap().join();
        if !std::thread::panicking() {
            joined.unwrap();
        }
    }
}
fn send_response(connection: &mut TcpStream, response: Response) -> std::io::Result<()> {
    match response {
        Response::Bytes(bytes) => connection.write_all(&bytes),
        Response::Chunked(mut remaining) => {
            connection.write_all(
                b"HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n",
            )?;
            let block = vec![b'x'; 256 * 1024];
            while remaining > 0 {
                let length = remaining.min(block.len());
                write!(connection, "{length:x}\r\n")?;
                connection.write_all(&block[..length])?;
                connection.write_all(b"\r\n")?;
                remaining -= length;
            }
            connection.write_all(b"0\r\n\r\n")
        }
    }
}
fn server(responses: Vec<Response>) -> Server {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    listener.set_nonblocking(true).unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    let requests = Arc::new(Mutex::new(vec![]));
    let received = requests.clone();
    let stop = Arc::new(AtomicBool::new(false));
    let stopping = stop.clone();
    let worker = std::thread::spawn(move || {
        for response in responses {
            let deadline = Instant::now() + Duration::from_secs(10);
            let mut connection = loop {
                if stopping.load(Ordering::Acquire) || Instant::now() >= deadline {
                    return;
                }
                match listener.accept() {
                    Ok((connection, _)) => break connection,
                    Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                        std::thread::sleep(Duration::from_millis(2));
                    }
                    Err(error) => panic!("fixture accept failed: {error}"),
                }
            };
            connection.set_nonblocking(false).unwrap();
            connection
                .set_read_timeout(Some(Duration::from_secs(3)))
                .unwrap();
            connection
                .set_write_timeout(Some(Duration::from_secs(10)))
                .unwrap();
            let mut request = Vec::new();
            while !request.ends_with(b"\r\n\r\n") {
                let mut byte = [0];
                connection.read_exact(&mut byte).unwrap();
                request.push(byte[0]);
                assert!(request.len() <= 16384);
            }
            received
                .lock()
                .unwrap()
                .push(String::from_utf8(request).unwrap());
            // Limit rejection intentionally closes a socket before the response ends.
            if let Err(error) = send_response(&mut connection, response) {
                assert!(
                    matches!(
                        error.kind(),
                        std::io::ErrorKind::BrokenPipe
                            | std::io::ErrorKind::ConnectionReset
                            | std::io::ErrorKind::ConnectionAborted
                    ),
                    "fixture socket write failed: {:?}",
                    error.kind()
                );
            }
        }
    });
    Server {
        url,
        requests,
        stop,
        worker: Some(worker),
    }
}
fn ok(body: &[u8]) -> Response {
    let mut response = format!(
        "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        body.len()
    )
    .into_bytes();
    response.extend(body);
    Response::Bytes(response)
}
fn length_only(length: usize) -> Response {
    Response::Bytes(
        format!("HTTP/1.1 200 OK\r\nContent-Length: {length}\r\nConnection: close\r\n\r\n")
            .into_bytes(),
    )
}
fn manifest(url: &str, signature: &str, version: &str) -> Response {
    ok(&serde_json::to_vec(&serde_json::json!({
        "version": version,
        "url": url,
        "signature": signature.trim(),
        "notes": "<b>literal release notes</b>",
    }))
    .unwrap())
}
fn fixture_app() -> tauri::App<tauri::test::MockRuntime> {
    let mut context = tauri::test::mock_context(tauri::test::noop_assets());
    context.config_mut().plugins.0.insert(
        "updater".into(),
        serde_json::json!({
            "pubkey": PUBLIC_KEY.trim(),
            "requireSignedVersion": true,
            "allowDowngrades": false,
            // Only this in-process fixture permits HTTP; production validates HTTPS.
            "dangerousInsecureTransportProtocol": true,
        }),
    );
    tauri::test::mock_builder()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .build(context)
        .unwrap()
}
fn builder(
    app: &tauri::App<tauri::test::MockRuntime>,
    endpoint: &str,
    snapshot: Arc<ProxySnapshot>,
) -> UpdaterBuilder {
    builder_with(app, endpoint, snapshot, Arc::from([]))
}
fn builder_with(
    app: &tauri::App<tauri::test::MockRuntime>,
    endpoint: &str,
    snapshot: Arc<ProxySnapshot>,
    redirect_hosts: Arc<[String]>,
) -> UpdaterBuilder {
    let policy = client_policy(snapshot, redirect_hosts);
    app.updater_builder()
        .target("windows-x86_64-nsis")
        .endpoints(vec![endpoint.parse().unwrap()])
        .unwrap()
        .timeout(Duration::from_secs(5))
        // All fixtures use HTTP. An empty trust store rejects all TLS and avoids
        // relying on the sandbox's Windows root-store access for these tests.
        .configure_client(move |client| policy(client.tls_certs_only([])))
        .on_before_exit(|| {})
        .installer_launcher(Arc::new(|_, _| panic!("unexpected installer attempt")))
}

#[tokio::test]
async fn real_vendor_signatures_and_signed_version() {
    for (payload, signature, version, succeeds) in [
        (PAYLOAD, SIGNATURE, "0.2.0", true),
        (b"MZtampered".as_slice(), SIGNATURE, "0.2.0", false),
        (PAYLOAD, WRONG_KEY, "0.2.0", false),
        (PAYLOAD, SIGNATURE, "0.3.0", false),
    ] {
        let download = server(vec![ok(payload)]);
        let metadata = server(vec![manifest(&download.url, signature, version)]);
        let app = fixture_app();
        let update = builder(&app, &metadata.url, Arc::new(ProxySnapshot::Direct))
            .build()
            .unwrap()
            .check()
            .await
            .unwrap()
            .unwrap();
        let result = update.download(|_, _| {}, || {}).await;
        if succeeds {
            assert_eq!(result.unwrap(), PAYLOAD);
        } else {
            assert!(matches!(
                result,
                Err(Error::Minisign(_)
                    | Error::SignedVersionMismatch { .. }
                    | Error::MissingSignedVersion)
            ));
        }
        assert_eq!(metadata.requests.lock().unwrap().len(), 1);
        assert_eq!(download.requests.lock().unwrap().len(), 1);
    }
}

#[tokio::test]
async fn real_vendor_manifest_and_download_actual_limits() {
    use tauri_plugin_updater::{MAX_DOWNLOAD_BYTES, MAX_MANIFEST_BYTES};
    for response in [
        length_only(MAX_MANIFEST_BYTES + 1),
        Response::Chunked(MAX_MANIFEST_BYTES + 1),
    ] {
        let metadata = server(vec![response]);
        let app = fixture_app();
        let result = builder(&app, &metadata.url, Arc::new(ProxySnapshot::Direct))
            .build()
            .unwrap()
            .check()
            .await;
        assert!(matches!(result, Err(Error::DownloadTooLarge)));
    }
    for response in [
        length_only(MAX_DOWNLOAD_BYTES + 1),
        Response::Chunked(MAX_DOWNLOAD_BYTES + 1),
    ] {
        let download = server(vec![response]);
        let metadata = server(vec![manifest(&download.url, SIGNATURE, "0.2.0")]);
        let app = fixture_app();
        let update = builder(&app, &metadata.url, Arc::new(ProxySnapshot::Direct))
            .build()
            .unwrap()
            .check()
            .await
            .unwrap()
            .unwrap();
        let mut bytes = 0;
        let result = update.download(|length, _| bytes += length, || {}).await;
        assert!(matches!(result, Err(Error::DownloadTooLarge)));
        assert!(bytes <= MAX_DOWNLOAD_BYTES);
    }
}

#[tokio::test]
async fn real_vendor_no_downgrade_or_redirect() {
    let unused = TcpListener::bind("127.0.0.1:0").unwrap();
    unused.set_nonblocking(true).unwrap();
    let url = format!("http://{}", unused.local_addr().unwrap());
    for version in ["0.1.0", "0.0.9"] {
        let metadata = server(vec![manifest(&url, SIGNATURE, version)]);
        let app = fixture_app();
        assert!(
            builder(&app, &metadata.url, Arc::new(ProxySnapshot::Direct))
                .build()
                .unwrap()
                .check()
                .await
                .unwrap()
                .is_none()
        );
    }
    let metadata = server(vec![Response::Bytes(format!(
        "HTTP/1.1 302 Found\r\nLocation: {url}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
    ).into_bytes())]);
    let app = fixture_app();
    assert!(
        builder(&app, &metadata.url, Arc::new(ProxySnapshot::Direct))
            .build()
            .unwrap()
            .check()
            .await
            .is_err()
    );
    assert!(
        matches!(unused.accept(), Err(error) if error.kind() == std::io::ErrorKind::WouldBlock)
    );
}

fn redirect(location: &str) -> Response {
    Response::Bytes(
        format!(
            "HTTP/1.1 302 Found
Location: {location}
Content-Length: 0
Connection: close

"
        )
        .into_bytes(),
    )
}

#[tokio::test]
async fn real_vendor_follows_redirects_only_to_release_hosts() {
    let download = server(vec![ok(PAYLOAD)]);
    let moved = server(vec![redirect(&format!("{}/setup.exe", download.url))]);
    let manifest_host = server(vec![manifest(
        &format!("{}/setup.exe", moved.url),
        SIGNATURE,
        "0.2.0",
    )]);
    let metadata = server(vec![redirect(&format!(
        "{}/latest.json",
        manifest_host.url
    ))]);
    let app = fixture_app();
    let update = builder_with(
        &app,
        &metadata.url,
        Arc::new(ProxySnapshot::Direct),
        Arc::from(["127.0.0.1".to_owned()]),
    )
    .build()
    .unwrap()
    .check()
    .await
    .unwrap()
    .unwrap();
    assert_eq!(update.download(|_, _| {}, || {}).await.unwrap(), PAYLOAD);
    for server in [&download, &moved, &manifest_host, &metadata] {
        assert_eq!(server.requests.lock().unwrap().len(), 1);
    }
    // 同一台机器换个主机名也不在名单里，不跟随。
    let target = server(vec![ok(b"{}")]);
    let port = target.url.rsplit(':').next().unwrap();
    let away = server(vec![redirect(&format!(
        "http://localhost:{port}/latest.json"
    ))]);
    let app = fixture_app();
    assert!(
        builder_with(
            &app,
            &away.url,
            Arc::new(ProxySnapshot::Direct),
            Arc::from(["127.0.0.1".to_owned()]),
        )
        .build()
        .unwrap()
        .check()
        .await
        .is_err()
    );
    assert!(target.requests.lock().unwrap().is_empty());
}

#[test]
fn redirects_need_a_listed_host_the_same_scheme_and_few_hops() {
    let hosts = [
        "github.com".to_owned(),
        "release-assets.githubusercontent.com".to_owned(),
    ];
    let url = |value: &str| tauri::Url::parse(value).unwrap();
    let latest = url("https://github.com/o/r/releases/latest/download/latest.json");
    let tagged = url("https://github.com/o/r/releases/download/v0.1.0/latest.json");
    let asset =
        url("https://release-assets.githubusercontent.com/github-production-release-asset/1?sig=x");
    assert!(redirect_allowed(&hosts, &latest, &tagged, 0));
    assert!(redirect_allowed(&hosts, &tagged, &asset, 1));
    assert!(!redirect_allowed(&hosts, &tagged, &asset, 5));
    assert!(!redirect_allowed(
        &hosts,
        &tagged,
        &url("http://release-assets.githubusercontent.com/x"),
        1
    ));
    assert!(!redirect_allowed(
        &hosts,
        &tagged,
        &url("https://example.com/x"),
        1
    ));
    assert!(!redirect_allowed(
        &hosts,
        &tagged,
        &url("https://github.com.example.com/x"),
        1
    ));
}

fn manual(endpoint: &str) -> Arc<ProxySnapshot> {
    Arc::new(ProxySnapshot::Manual {
        endpoint: endpoint.into(),
        credentials: Some(tenon_framework::network::ProxyCredentials {
            username: "fixture-user".into(),
            password: "fixture-password".into(),
        }),
    })
}

#[tokio::test]
async fn both_proxy_stages_auth_and_no_direct_fallback() {
    // 127.0.0.2 is loopback, but deliberately is not the policy's precise
    // 127.0.0.1 bypass. No DNS or external addresses are used.
    let target = TcpListener::bind("127.0.0.2:0").unwrap();
    target.set_nonblocking(true).unwrap();
    let url = format!("http://{}/update.exe", target.local_addr().unwrap());
    for fail_download in [false, true] {
        let proxy = server(vec![
            manifest(&url, SIGNATURE, "0.2.0"),
            if fail_download {
                Response::Bytes(
                    b"HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
                        .to_vec(),
                )
            } else {
                ok(PAYLOAD)
            },
        ]);
        let app = fixture_app();
        let update = builder(&app, &url, manual(&proxy.url))
            .build()
            .unwrap()
            .check()
            .await
            .unwrap()
            .unwrap();
        let result = update.download(|_, _| {}, || {}).await;
        assert_eq!(result.is_ok(), !fail_download);
        let requests = proxy.requests.lock().unwrap();
        assert_eq!(requests.len(), 2);
        for request in requests.iter() {
            assert!(
                request
                    .to_ascii_lowercase()
                    .contains("proxy-authorization: basic ")
            );
            assert!(!request.contains("fixture-password"));
        }
        assert!(
            matches!(target.accept(), Err(error) if error.kind() == std::io::ErrorKind::WouldBlock)
        );
    }
    let proxy = server(vec![Response::Bytes(
        b"HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".to_vec(),
    )]);
    let app = fixture_app();
    assert!(
        builder(&app, &url, manual(&proxy.url))
            .build()
            .unwrap()
            .check()
            .await
            .is_err()
    );
    assert_eq!(proxy.requests.lock().unwrap().len(), 1);
    assert!(
        matches!(target.accept(), Err(error) if error.kind() == std::io::ErrorKind::WouldBlock)
    );

    // The same manual policy must keep exact loopback local and omit proxy credentials.
    let download = server(vec![ok(PAYLOAD)]);
    let metadata = server(vec![manifest(&download.url, SIGNATURE, "0.2.0")]);
    let app = fixture_app();
    let update = builder(&app, &metadata.url, manual(&url))
        .build()
        .unwrap()
        .check()
        .await
        .unwrap()
        .unwrap();
    assert_eq!(update.download(|_, _| {}, || {}).await.unwrap(), PAYLOAD);
    for server in [&metadata, &download] {
        assert!(
            !server.requests.lock().unwrap()[0]
                .to_ascii_lowercase()
                .contains("proxy-authorization")
        );
    }
}

#[cfg(windows)]
#[tokio::test]
async fn real_vendor_scratch_and_installer_seam() {
    let root = crate::boot::tests::root();
    let metadata = server(vec![manifest(
        "http://127.0.0.1:1/unused",
        SIGNATURE,
        "0.2.0",
    )]);
    let app = fixture_app();
    let update = builder(&app, &metadata.url, Arc::new(ProxySnapshot::Direct))
        .build()
        .unwrap()
        .check()
        .await
        .unwrap()
        .unwrap();
    assert!(matches!(
        update.install(PAYLOAD),
        Err(Error::TempDirNotFound)
    ));
    assert!(
        builder(&app, &metadata.url, Arc::new(ProxySnapshot::Direct))
            .scratch_root(PathBuf::from("relative"))
            .is_err()
    );

    let scratch = root.path().join("scratch");
    std::fs::create_dir(&scratch).unwrap();
    let metadata = server(vec![manifest(
        "http://127.0.0.1:1/unused",
        SIGNATURE,
        "0.2.0",
    )]);
    let update = builder(&app, &metadata.url, Arc::new(ProxySnapshot::Direct))
        .scratch_root(scratch.clone())
        .unwrap()
        .build()
        .unwrap()
        .check()
        .await
        .unwrap()
        .unwrap();
    // Make the validated location unwritable as a directory without touching ACLs.
    std::fs::remove_dir(&scratch).unwrap();
    std::fs::write(&scratch, b"unavailable directory").unwrap();
    assert!(matches!(update.install(PAYLOAD), Err(Error::Io(_))));
    std::fs::remove_file(&scratch).unwrap();
    std::fs::create_dir(&scratch).unwrap();

    let metadata = server(vec![manifest(
        "http://127.0.0.1:1/unused",
        SIGNATURE,
        "0.2.0",
    )]);
    let events = Arc::new(Mutex::new(vec![]));
    let hook_events = events.clone();
    let launch_events = events.clone();
    let expected = scratch.canonicalize().unwrap();
    let update = builder(&app, &metadata.url, Arc::new(ProxySnapshot::Direct))
        .scratch_root(scratch)
        .unwrap()
        .on_before_exit(move || {
            std::thread::sleep(Duration::from_millis(20));
            hook_events.lock().unwrap().extend(["shutdown", "cleanup"]);
        })
        .installer_launcher(Arc::new(move |file, _| {
            assert!(Path::new(file).starts_with(&expected));
            assert_eq!(*launch_events.lock().unwrap(), ["shutdown", "cleanup"]);
            launch_events.lock().unwrap().push("launcher");
            Err(Error::InvalidUpdaterFormat)
        }))
        .build()
        .unwrap()
        .check()
        .await
        .unwrap()
        .unwrap();
    assert!(update.install(PAYLOAD).is_err());
    assert_eq!(*events.lock().unwrap(), ["shutdown", "cleanup", "launcher"]);
}

#[tokio::test]
async fn exact_size_boundaries_reach_parsing_and_signature_verification() {
    use tauri_plugin_updater::{MAX_DOWNLOAD_BYTES, MAX_MANIFEST_BYTES};
    assert_eq!(
        MAX_MANIFEST_BYTES as u64,
        tenon_desktop::native::updater::MANIFEST_LIMIT
    );
    assert_eq!(
        MAX_DOWNLOAD_BYTES as u64,
        tenon_desktop::native::updater::DOWNLOAD_LIMIT
    );
    let mut body = serde_json::to_vec(&serde_json::json!({
        "version":"0.2.0", "url":"http://127.0.0.1:1/unused", "signature":SIGNATURE.trim()
    }))
    .unwrap();
    body.resize(MAX_MANIFEST_BYTES, b' ');
    let metadata = server(vec![ok(&body)]);
    let app = fixture_app();
    assert!(
        builder(&app, &metadata.url, Arc::new(ProxySnapshot::Direct))
            .build()
            .unwrap()
            .check()
            .await
            .unwrap()
            .is_some()
    );
    let download = server(vec![Response::Chunked(MAX_DOWNLOAD_BYTES)]);
    let metadata = server(vec![manifest(&download.url, SIGNATURE, "0.2.0")]);
    let update = builder(&app, &metadata.url, Arc::new(ProxySnapshot::Direct))
        .build()
        .unwrap()
        .check()
        .await
        .unwrap()
        .unwrap();
    let mut received = 0;
    let result = update.download(|length, _| received += length, || {}).await;
    assert_eq!(received, MAX_DOWNLOAD_BYTES);
    assert!(matches!(result, Err(Error::Minisign(_))));
}
