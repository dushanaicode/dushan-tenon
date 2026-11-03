//! 唯一发行配置的校验；生产入口不接受外部传入的发行 URL 或公钥。

use serde::Deserialize;
use tenon_desktop::native::updater::INVALID_RELEASE;
use tenon_framework::error::AppError;

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct ReleaseConfig {
    pub(super) product_id: String,
    pub(super) channel: String,
    pub(super) endpoints: Vec<String>,
    pub(super) pubkey: String,
    pub(super) download_hosts: Vec<String>,
    pub(super) target: String,
}

impl ReleaseConfig {
    pub(super) fn validate(&self, product: &str) -> Result<(), AppError> {
        use base64::Engine;
        let invalid = || AppError::new(INVALID_RELEASE);
        if self.product_id != product
            || self.channel != "stable"
            || !matches!(
                self.target.as_str(),
                "windows-x86_64-nsis"
                    | "windows-x86_64-msi"
                    | "windows-aarch64-nsis"
                    | "windows-aarch64-msi"
                    | "windows-i686-nsis"
                    | "windows-i686-msi"
                    | "darwin-x86_64-app"
                    | "darwin-aarch64-app"
                    | "linux-x86_64-appimage"
                    | "linux-aarch64-appimage"
            )
            || self.endpoints.is_empty()
            || self.endpoints.len() > 16
            || self.download_hosts.is_empty()
            || self.download_hosts.len() > 16
        {
            return Err(invalid());
        }
        let public = base64::engine::general_purpose::STANDARD
            .decode(&self.pubkey)
            .map_err(|_| invalid())?;
        let public = std::str::from_utf8(&public).map_err(|_| invalid())?;
        let mut lines = public.lines();
        if !lines
            .next()
            .is_some_and(|line| line.starts_with("untrusted comment: "))
        {
            return Err(invalid());
        }
        let key = base64::engine::general_purpose::STANDARD
            .decode(lines.next().ok_or_else(invalid)?)
            .map_err(|_| invalid())?;
        if lines.next().is_some() || key.len() != 42 || &key[..2] != b"Ed" {
            return Err(invalid());
        }
        for endpoint in &self.endpoints {
            if endpoint.len() > 2048 {
                return Err(invalid());
            }
            https_url(endpoint)?;
        }
        for host in &self.download_hosts {
            let url = https_url(&format!("https://{host}"))?;
            if url.host_str() != Some(host)
                || url.port().is_some()
                || url.path() != "/"
                || url.query().is_some()
                || url.as_str() != format!("https://{host}/")
            {
                return Err(invalid());
            }
        }
        Ok(())
    }

    pub(super) fn download_url(&self, url: &tauri::Url) -> Result<(), AppError> {
        https_url(url.as_str())?;
        let host = url
            .host_str()
            .ok_or_else(|| AppError::new(INVALID_RELEASE))?;
        let extension = match self.target.rsplit('-').next() {
            Some("nsis") => ".exe",
            Some("msi") => ".msi",
            Some("app") => ".app.tar.gz",
            Some("appimage") => ".AppImage",
            _ => return Err(AppError::new(INVALID_RELEASE)),
        };
        if !self.download_hosts.iter().any(|allowed| allowed == host)
            || !url.path().ends_with(extension)
        {
            return Err(AppError::new(INVALID_RELEASE));
        }
        Ok(())
    }
}

fn https_url(value: &str) -> Result<tauri::Url, AppError> {
    let url = tauri::Url::parse(value).map_err(|_| AppError::new(INVALID_RELEASE))?;
    if url.scheme() != "https"
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.fragment().is_some()
    {
        return Err(AppError::new(INVALID_RELEASE));
    }
    Ok(url)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn production_release_requires_https_hosts_and_bare_installer() {
        let mut config = ReleaseConfig {
            product_id: "fixture".into(),
            channel: "stable".into(),
            endpoints: vec!["https://updates.example.test/stable".into()],
            pubkey: include_str!(
                "../../../../vendor/tauri-plugin-updater/tests/fixtures/public-key.txt"
            )
            .trim()
            .into(),
            download_hosts: vec!["downloads.example.test".into()],
            target: "windows-x86_64-nsis".into(),
        };
        config.validate("fixture").unwrap();
        config
            .download_url(&"https://downloads.example.test/update.exe".parse().unwrap())
            .unwrap();
        for url in [
            "http://downloads.example.test/update.exe",
            "https://other.example.test/update.exe",
            "https://downloads.example.test/update.exe.zip",
            "https://user:secret@downloads.example.test/update.exe",
        ] {
            assert!(config.download_url(&url.parse().unwrap()).is_err());
        }
        assert!(config.validate("different").is_err());
        for (target, suffix) in [
            ("darwin-x86_64-app", ".app.tar.gz"),
            ("darwin-aarch64-app", ".app.tar.gz"),
            ("linux-x86_64-appimage", ".AppImage"),
            ("linux-aarch64-appimage", ".AppImage"),
        ] {
            config.target = target.into();
            config.validate("fixture").unwrap();
            config
                .download_url(
                    &format!("https://downloads.example.test/update{suffix}")
                        .parse()
                        .unwrap(),
                )
                .unwrap();
            assert!(
                config
                    .download_url(
                        &format!("https://downloads.example.test/update{suffix}.zip")
                            .parse()
                            .unwrap()
                    )
                    .is_err()
            );
        }
    }
}
