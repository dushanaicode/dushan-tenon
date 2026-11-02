//! 网络设置只保存模式、端点与认证开关；凭据仍由 framework secret 持有。

use std::path::Path;

use serde::Serialize;
use tenon_framework::{
    error::AppError,
    network::{ProxyConfig, ProxyMode},
};
use ts_rs::TS;

use super::{LoadedConfig, Setting, persist::change};

#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct NetworkConfigSettings {
    pub mode: Setting<ProxyMode>,
    pub endpoint: Setting<String>,
    pub auth: Setting<bool>,
}

impl LoadedConfig {
    pub(crate) fn validate_network_settings(
        &self,
        mode: ProxyMode,
        endpoint: &str,
        auth: bool,
    ) -> Result<(), AppError> {
        for key in [
            "network.proxy_mode",
            "network.proxy_endpoint",
            "network.proxy_auth",
        ] {
            self.sources.check_writable(key)?;
        }
        ProxyConfig::new(mode, endpoint.into(), auth)?;
        Ok(())
    }

    pub fn network_settings(&self) -> NetworkConfigSettings {
        NetworkConfigSettings {
            mode: self.setting("network.proxy_mode", self.values.network.mode()),
            endpoint: self.setting(
                "network.proxy_endpoint",
                self.values.network.endpoint().to_owned(),
            ),
            auth: self.setting("network.proxy_auth", self.values.network.auth()),
        }
    }

    pub fn update_network_settings(
        &mut self,
        root: &Path,
        mode: ProxyMode,
        endpoint: &str,
        auth: bool,
    ) -> Result<(), AppError> {
        let mut changes = Vec::new();
        change(
            &self.sources,
            &mut changes,
            "network.proxy_mode",
            &mut self.values.network.mode(),
            mode,
        )?;
        change(
            &self.sources,
            &mut changes,
            "network.proxy_endpoint",
            &mut self.values.network.endpoint().to_owned(),
            endpoint.to_owned(),
        )?;
        change(
            &self.sources,
            &mut changes,
            "network.proxy_auth",
            &mut self.values.network.auth(),
            auth,
        )?;
        let mut values = self.values.clone();
        values.network = ProxyConfig::new(mode, endpoint.into(), auth)?;
        self.commit(root, values, changes)
    }
}
