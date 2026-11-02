//! proxy 行为测试。

use super::*;

#[test]
fn every_proxy_source_locks_the_group_even_for_unchanged_values() {
    let root = state_root();
    let path = root.path().join("config.toml");
    let text = "# proxy\n[network]\nproxy_mode='direct'\nproxy_endpoint='https://proxy.example:443'\nproxy_auth=true\n";
    fs::write(&path, text).unwrap();
    for (key, value) in [
        ("proxy_mode", "direct"),
        ("proxy_endpoint", "https://proxy.example:443"),
        ("proxy_auth", "true"),
    ] {
        let env = format!("TENON__NETWORK__{}", key.to_ascii_uppercase());
        let cli = format!("network.{key}={value}");
        for (environment, overrides) in [
            (vec![(env.as_str(), value)], vec![]),
            (vec![], vec![cli.as_str()]),
        ] {
            let mut config = read(root.path(), &environment, &overrides).unwrap();
            for endpoint in ["https://proxy.example:443", "http://invalid.example"] {
                let error = config
                    .update_network_settings(root.path(), ProxyMode::Direct, endpoint, true)
                    .unwrap_err();
                assert_eq!(error.code(), SETTINGS_OVERRIDDEN);
                assert_eq!(error.params()["key"], format!("network.{key}"));
                assert_eq!(fs::read_to_string(&path).unwrap(), text);
            }
        }
    }
}

#[test]
fn invalid_proxy_and_failed_write_preserve_file_and_memory() {
    let root = state_root();
    let mut config = read(root.path(), &[], &[]).unwrap();
    for mode in [ProxyMode::Direct, ProxyMode::Manual] {
        assert_eq!(
            config
                .update_network_settings(root.path(), mode, "http://remote.example", false)
                .unwrap_err()
                .code(),
            tenon_framework::network::INVALID_PROXY
        );
        assert!(!root.path().join("config.toml").exists());
    }
    assert!(
        config
            .update_network_settings(
                &root.path().join("missing"),
                ProxyMode::Manual,
                "http://127.0.0.1:8080",
                true
            )
            .is_err()
    );
    assert_eq!(config.proxy().mode(), ProxyMode::Direct);
    assert_eq!(config.proxy().endpoint(), "");
    assert!(!config.proxy().auth());
}

#[test]
fn network_sources_validation_and_atomic_write() {
    let root = tempfile::tempdir().unwrap();
    let mut config = super::load(root.path(), [], &[]).unwrap();
    assert_eq!(
        config.network_settings().mode.value,
        super::ProxyMode::Direct
    );
    config
        .update_network_settings(
            root.path(),
            super::ProxyMode::Manual,
            "https://proxy.example:443",
            false,
        )
        .unwrap();
    let mut loaded = super::load(
        root.path(),
        [("TENON__NETWORK__PROXY_MODE".into(), "direct".into())],
        &["network.proxy_auth=true".into()],
    )
    .unwrap();
    let saved = loaded.network_settings();
    assert_eq!(saved.mode.source, super::ConfigSource::Environment);
    assert_eq!(saved.endpoint.source, super::ConfigSource::File);
    assert_eq!(saved.auth.source, super::ConfigSource::CommandLine);
    assert_eq!(
        loaded
            .update_network_settings(root.path(), super::ProxyMode::Direct, "", false)
            .unwrap_err()
            .code(),
        SETTINGS_OVERRIDDEN
    );
    for value in ["system", "pac", "socks"] {
        assert!(super::load(root.path(), [], &[format!("network.proxy_mode={value}")]).is_err());
    }
    for (_, preset) in PRESETS {
        let seed = state_root();
        fs::write(seed.path().join("config.toml"), preset).unwrap();
        let saved = super::load(seed.path(), [], &[])
            .unwrap()
            .network_settings();
        assert_eq!(saved.mode.value, super::ProxyMode::Direct);
        assert_eq!(saved.endpoint.value, "");
        assert!(!saved.auth.value);
    }
}
