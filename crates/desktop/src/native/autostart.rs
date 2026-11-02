//! 自启意图、系统观察与精确补偿；不访问注册表，禁用审批永不改写。

use std::{
    path::Path,
    sync::{Arc, Mutex},
};

use serde::Serialize;
use tenon_framework::error::{AppError, ErrorCode, IpcError};
use ts_rs::TS;

use super::{NativeFailure, UNAVAILABLE, check_source};
use crate::config::{AutostartSettingsChange, LoadedConfig, NativeSettingsChange, Setting};

pub const UNSUPPORTED: ErrorCode = ErrorCode::new("app.native.autostart_unsupported");

pub trait AutostartAdapter: Send + Sync {
    fn registered(&self) -> Result<Registration, AppError>;
    fn approval(&self) -> Result<StartupApproval, AppError>;
    fn set_registered(&self, enabled: bool) -> Result<Registration, AppError>;
    fn restore(&self, snapshot: &Registration) -> Result<(), AppError>;
}

/// 完整登记只用于内存补偿；不实现 Debug/Serialize，不能进入 IPC 或日志。
#[derive(Clone, Default, PartialEq, Eq)]
pub enum Registration {
    Registered(String),
    #[default]
    NotRegistered,
}

impl Registration {
    fn is_registered(&self) -> bool {
        matches!(self, Self::Registered(_))
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub enum StartupApproval {
    Allowed,
    Disabled,
    Unknown,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub enum EffectiveStartup {
    Enabled,
    Disabled,
    Unknown,
}

#[derive(Debug, Serialize, TS)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum ObservedBool {
    Known { value: bool },
    Unknown { error: IpcError },
    Unsupported { reason: AutostartUnsupportedReason },
}

#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub enum AutostartState {
    Ready,
    Unavailable,
    Degraded,
    Unsupported,
}

#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct AutostartSettings {
    pub desired: Setting<bool>,
    pub registered: ObservedBool,
    pub approval: StartupApproval,
    pub approval_error: Option<IpcError>,
    pub effective_startup: EffectiveStartup,
    pub state: AutostartState,
    pub error: Option<IpcError>,
}

pub struct Autostart {
    scope: AutostartScope,
    adapter: Option<Arc<dyn AutostartAdapter>>,
    operation: Mutex<Option<NativeFailure>>,
}

impl Autostart {
    pub fn new(
        scope: AutostartScope,
        adapter: Option<Arc<dyn AutostartAdapter>>,
    ) -> Result<Self, AppError> {
        if matches!(scope, AutostartScope::Product) != adapter.is_some() {
            return Err(AppError::new(tenon_framework::error::INPUT_INVALID));
        }
        Ok(Self {
            scope,
            adapter,
            operation: Mutex::new(None),
        })
    }

    pub fn settings(
        &self,
        config: &Mutex<LoadedConfig>,
        trace_id: &str,
    ) -> Result<AutostartSettings, AppError> {
        let failure = super::lock(&self.operation)?;
        let desired = super::lock(config)?.native_settings().autostart;
        let (registered, approval, approval_error) = match self.scope {
            AutostartScope::Unsupported(reason) => (
                ObservedBool::Unsupported { reason },
                StartupApproval::Unknown,
                None,
            ),
            AutostartScope::Product => {
                let adapter = self
                    .adapter
                    .as_ref()
                    .ok_or_else(|| AppError::new(UNSUPPORTED))?;
                let registered = match adapter.registered() {
                    Ok(snapshot) => ObservedBool::Known {
                        value: snapshot.is_registered(),
                    },
                    Err(_) => ObservedBool::Unknown {
                        error: NativeFailure::new(UNAVAILABLE).ipc(trace_id),
                    },
                };
                let (approval, error) = match adapter.approval() {
                    Ok(approval) => (approval, None),
                    Err(_) => (
                        StartupApproval::Unknown,
                        Some(NativeFailure::new(UNAVAILABLE).ipc(trace_id)),
                    ),
                };
                (registered, approval, error)
            }
        };
        let state = match (&registered, *failure) {
            (ObservedBool::Unsupported { .. }, _) => AutostartState::Unsupported,
            (
                _,
                Some(NativeFailure {
                    compensation: Some(_),
                    ..
                }),
            ) => AutostartState::Degraded,
            (ObservedBool::Unknown { .. }, _) | (_, Some(_)) => AutostartState::Unavailable,
            _ if approval_error.is_some() => AutostartState::Unavailable,
            _ => AutostartState::Ready,
        };
        let effective_startup = match (&registered, approval) {
            (_, StartupApproval::Unknown) => EffectiveStartup::Unknown,
            (ObservedBool::Known { value: true }, StartupApproval::Allowed) => {
                EffectiveStartup::Enabled
            }
            (ObservedBool::Known { .. }, _) => EffectiveStartup::Disabled,
            _ => EffectiveStartup::Unknown,
        };
        Ok(AutostartSettings {
            desired,
            registered,
            approval,
            approval_error,
            effective_startup,
            state,
            error: failure.map(|error| error.ipc(trace_id)),
        })
    }

    pub fn update(
        &self,
        config: &Mutex<LoadedConfig>,
        root: &Path,
        enabled: bool,
    ) -> Result<(), AppError> {
        if matches!(self.scope, AutostartScope::Unsupported(_)) {
            return Err(AppError::new(UNSUPPORTED));
        }
        let mut failure = super::lock(&self.operation)?;
        let mut config = super::lock(config)?;
        check_source(
            config.native_settings().autostart.source,
            "autostart.enabled",
        )?;
        let result = apply(
            self.adapter
                .as_ref()
                .ok_or_else(|| AppError::new(UNSUPPORTED))?
                .as_ref(),
            enabled,
            || {
                config
                    .update_native_settings(
                        root,
                        &NativeSettingsChange::Autostart(AutostartSettingsChange { enabled }),
                    )
                    .map(|_| ())
                    .map_err(|_| AppError::new(UNAVAILABLE))
            },
        );
        *failure = result.err();
        failure.map_or(Ok(()), |error| Err(error.error()))
    }
}

fn apply(
    adapter: &dyn AutostartAdapter,
    enabled: bool,
    persist: impl FnOnce() -> Result<(), AppError>,
) -> Result<(), NativeFailure> {
    let original = adapter
        .registered()
        .map_err(|_| NativeFailure::new(UNAVAILABLE))?;
    let changed = original.is_registered() != enabled;
    let applied = (|| {
        let target = if changed {
            adapter.set_registered(enabled)?
        } else {
            original.clone()
        };
        if target.is_registered() != enabled {
            return Err(AppError::new(UNAVAILABLE));
        }
        match adapter.registered() {
            Ok(value) if value == target => persist(),
            _ => Err(AppError::new(UNAVAILABLE)),
        }
    })();
    if let Err(error) = applied {
        let mut failure = NativeFailure::new(error.code());
        if changed {
            let restored = adapter.restore(&original);
            // 即使补偿返回失败也重读；精确比较原命令行，不混入放行策略。
            let observed = adapter.registered();
            if restored.is_err() || !matches!(observed, Ok(value) if value == original) {
                failure.compensation = Some(UNAVAILABLE);
            }
        }
        return Err(failure);
    }
    Ok(())
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub enum AutostartUnsupportedReason {
    Development,
    ExplicitStateRoot,
    NotInstalled,
    UnsupportedPlatform,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AutostartScope {
    Product,
    Unsupported(AutostartUnsupportedReason),
}

impl AutostartScope {
    /// 三个启动事实由调用方提供；不读取环境、文件或系统注册项。
    pub fn classify(development: bool, explicit_state_root: bool, installed: bool) -> Self {
        use AutostartUnsupportedReason::*;
        if !cfg!(windows) {
            Self::Unsupported(UnsupportedPlatform)
        } else if development {
            Self::Unsupported(Development)
        } else if explicit_state_root {
            Self::Unsupported(ExplicitStateRoot)
        } else if !installed {
            Self::Unsupported(NotInstalled)
        } else {
            Self::Product
        }
    }
}

/// 宿主只把 REG_BINARY 传为 Some(bytes)；缺失为 None，其他类型传空 slice。
pub fn parse_approval(value: Option<&[u8]>) -> StartupApproval {
    match value {
        None => StartupApproval::Allowed,
        Some(bytes) if bytes.len() == 12 => match bytes[0] {
            0x02 | 0x06 => StartupApproval::Allowed,
            0x03 | 0x07 => StartupApproval::Disabled,
            _ => StartupApproval::Unknown,
        },
        _ => StartupApproval::Unknown,
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    use std::{collections::BTreeSet, error::Error};

    #[derive(Default)]
    struct FakeState {
        value: Registration,
        read_fails: bool,
        approval: Option<StartupApproval>,
        approval_fails: bool,
        partial_write: bool,
        set_count: usize,
        failed_sets: BTreeSet<usize>,
        ignored_sets: BTreeSet<usize>,
        calls: Vec<String>,
    }

    #[derive(Default)]
    struct Fake(Mutex<FakeState>);

    impl Fake {
        fn write(&self, value: &Registration, operation: &str) -> Result<(), AppError> {
            let mut state = self.0.lock().unwrap();
            state
                .calls
                .push(format!("{operation}:{}", value.is_registered()));
            state.set_count += 1;
            if state.failed_sets.contains(&state.set_count) {
                if state.partial_write {
                    state.value = value.clone();
                }
                return Err(AppError::new(UNAVAILABLE));
            }
            if !state.ignored_sets.contains(&state.set_count) {
                state.value = value.clone();
            }
            Ok(())
        }
    }

    impl AutostartAdapter for Fake {
        fn registered(&self) -> Result<Registration, AppError> {
            let mut state = self.0.lock().unwrap();
            state.calls.push("read".into());
            if state.read_fails {
                Err(AppError::new(UNAVAILABLE)
                    .with_source(std::io::Error::other("PRIVATE_PATH_SENTINEL")))
            } else {
                Ok(state.value.clone())
            }
        }

        fn approval(&self) -> Result<StartupApproval, AppError> {
            let state = self.0.lock().unwrap();
            if state.approval_fails {
                Err(AppError::new(UNAVAILABLE))
            } else {
                Ok(state.approval.unwrap_or(StartupApproval::Allowed))
            }
        }

        fn set_registered(&self, enabled: bool) -> Result<Registration, AppError> {
            let target = if enabled {
                Registration::Registered("new-command".into())
            } else {
                Registration::NotRegistered
            };
            self.write(&target, "set")?;
            Ok(target)
        }

        fn restore(&self, snapshot: &Registration) -> Result<(), AppError> {
            self.write(snapshot, "restore")
        }
    }

    #[test]
    fn autostart_reads_system_not_intent() {
        let adapter = Arc::new(Fake::default());
        adapter.0.lock().unwrap().value = Registration::Registered("existing-command".into());
        let service = Autostart::new(AutostartScope::Product, Some(adapter.clone())).unwrap();
        let config = Mutex::new(crate::native::test_config());
        let state = service.settings(&config, "trace").unwrap();
        assert!(!state.desired.value);
        assert!(matches!(
            state.registered,
            ObservedBool::Known { value: true }
        ));
        assert_eq!(state.effective_startup, EffectiveStartup::Enabled);
        assert!(
            !serde_json::to_string(&state)
                .unwrap()
                .contains("existing-command")
        );
        assert_eq!(adapter.0.lock().unwrap().calls, ["read"]);
        adapter.0.lock().unwrap().read_fails = true;
        let state = service.settings(&config, "trace").unwrap();
        assert!(matches!(state.registered, ObservedBool::Unknown { .. }));
        assert!(
            !serde_json::to_string(&state)
                .unwrap()
                .contains("PRIVATE_PATH_SENTINEL")
        );
    }

    #[test]
    fn autostart_unsupported_has_no_system_adapter() {
        let config = Mutex::new(crate::native::test_config());
        let root = tempfile::tempdir().unwrap();
        for reason in [
            AutostartUnsupportedReason::Development,
            AutostartUnsupportedReason::ExplicitStateRoot,
            AutostartUnsupportedReason::NotInstalled,
            AutostartUnsupportedReason::UnsupportedPlatform,
        ] {
            let service = Autostart::new(AutostartScope::Unsupported(reason), None).unwrap();
            let state = service.settings(&config, "trace").unwrap();
            assert!(
                matches!(state.registered, ObservedBool::Unsupported { reason: actual } if actual == reason)
            );
            assert_eq!(
                service
                    .update(&config, root.path(), true)
                    .unwrap_err()
                    .code(),
                UNSUPPORTED
            );
            assert!(!root.path().join("config.toml").exists());
        }
    }

    #[test]
    fn autostart_system_failure_never_persists() {
        for read_fails in [false, true] {
            let adapter = Fake::default();
            adapter.0.lock().unwrap().read_fails = read_fails;
            adapter.0.lock().unwrap().failed_sets.insert(1);
            assert!(apply(&adapter, true, || panic!("系统失败不能写意图")).is_err());
            assert!(!adapter.0.lock().unwrap().value.is_registered());
        }
        let adapter = Fake::default();
        adapter.0.lock().unwrap().ignored_sets.insert(1);
        assert!(apply(&adapter, true, || panic!("读回不符不能写意图")).is_err());
        assert_eq!(
            adapter.0.lock().unwrap().calls,
            ["read", "set:true", "read", "restore:false", "read"]
        );
    }

    #[test]
    fn native_write_failure_compensates_autostart() {
        for compensation_fails in [false, true] {
            let adapter = Arc::new(Fake::default());
            if compensation_fails {
                adapter.0.lock().unwrap().failed_sets.insert(2);
            }
            let service = Autostart::new(AutostartScope::Product, Some(adapter.clone())).unwrap();
            let config = Mutex::new(crate::native::test_config());
            let root = tempfile::tempdir().unwrap();
            std::fs::create_dir(root.path().join("config.toml")).unwrap();
            let error = service.update(&config, root.path(), true).unwrap_err();
            assert!(error.source().is_none());
            assert_eq!(
                error.code(),
                if compensation_fails {
                    super::super::COMPENSATION_FAILED
                } else {
                    UNAVAILABLE
                }
            );
            assert_eq!(
                adapter.0.lock().unwrap().calls,
                ["read", "set:true", "read", "restore:false", "read"]
            );
            let state = service.settings(&config, "trace").unwrap();
            assert!(!state.desired.value);
            assert!(
                matches!(state.registered, ObservedBool::Known { value } if value == compensation_fails)
            );
            assert_eq!(
                matches!(state.state, AutostartState::Degraded),
                compensation_fails
            );
            if compensation_fails {
                let serialized = serde_json::to_value(state.error.unwrap()).unwrap();
                assert_eq!(serialized["params"]["operation"], UNAVAILABLE.as_str());
                assert_eq!(serialized["params"]["compensation"], UNAVAILABLE.as_str());
            }
        }
    }

    #[test]
    fn autostart_saves_verified_fact_and_rejects_overrides_before_system() {
        let root = tempfile::tempdir().unwrap();
        let config = Mutex::new(crate::native::test_config());
        let adapter = Arc::new(Fake::default());
        let service = Autostart::new(AutostartScope::Product, Some(adapter.clone())).unwrap();
        service.update(&config, root.path(), true).unwrap();
        assert!(config.lock().unwrap().native_settings().autostart.value);
        assert!(
            crate::config::load(root.path(), [], &[])
                .unwrap()
                .native_settings()
                .autostart
                .value
        );
        for (environment, overrides) in [
            (
                vec![("TENON__AUTOSTART__ENABLED".into(), "false".into())],
                vec![],
            ),
            (vec![], vec!["autostart.enabled=false".into()]),
        ] {
            let loaded = crate::config::load(root.path(), environment, &overrides).unwrap();
            let before = adapter.0.lock().unwrap().calls.len();
            assert_eq!(
                service
                    .update(&Mutex::new(loaded), root.path(), true)
                    .unwrap_err()
                    .code(),
                crate::config::SETTINGS_OVERRIDDEN
            );
            assert_eq!(adapter.0.lock().unwrap().calls.len(), before);
        }
    }

    #[test]
    fn autostart_rollback_restores_exact_command() {
        let adapter = Fake::default();
        let original = Registration::Registered(
            r#""C:\Previous Install\app.exe" --state-root "C:\old state\""#.into(),
        );
        adapter.0.lock().unwrap().value = original.clone();
        assert!(apply(&adapter, false, || Err(AppError::new(UNAVAILABLE))).is_err());
        assert!(adapter.0.lock().unwrap().value == original);
        assert_eq!(
            adapter.0.lock().unwrap().calls,
            ["read", "set:false", "read", "restore:true", "read"]
        );
    }

    #[test]
    fn approval_parser_accepts_only_known_twelve_byte_states() {
        assert_eq!(parse_approval(None), StartupApproval::Allowed);
        for value in 0..=255 {
            let mut bytes = [0u8; 12];
            bytes[0] = value;
            let expected = match value {
                2 | 6 => StartupApproval::Allowed,
                3 | 7 => StartupApproval::Disabled,
                _ => StartupApproval::Unknown,
            };
            assert_eq!(parse_approval(Some(&bytes)), expected);
            assert_eq!(parse_approval(Some(&bytes[..11])), StartupApproval::Unknown);
        }
        assert_eq!(parse_approval(Some(&[2; 13])), StartupApproval::Unknown);
    }

    #[test]
    fn autostart_scope_uses_ordered_explicit_inputs() {
        for development in [false, true] {
            for explicit in [false, true] {
                for installed in [false, true] {
                    use AutostartUnsupportedReason::*;
                    let expected = if !cfg!(windows) {
                        AutostartScope::Unsupported(UnsupportedPlatform)
                    } else if development {
                        AutostartScope::Unsupported(Development)
                    } else if explicit {
                        AutostartScope::Unsupported(ExplicitStateRoot)
                    } else if !installed {
                        AutostartScope::Unsupported(NotInstalled)
                    } else {
                        AutostartScope::Product
                    };
                    assert_eq!(
                        AutostartScope::classify(development, explicit, installed),
                        expected
                    );
                }
            }
        }
    }

    #[test]
    fn unknown_observation_never_claims_enabled_and_approval_is_preserved() {
        let adapter = Arc::new(Fake::default());
        let service = Autostart::new(AutostartScope::Product, Some(adapter.clone())).unwrap();
        let config = Mutex::new(crate::native::test_config());
        let root = tempfile::tempdir().unwrap();
        for registered_unknown in [false, true] {
            for approval in [
                StartupApproval::Allowed,
                StartupApproval::Disabled,
                StartupApproval::Unknown,
            ] {
                {
                    let mut state = adapter.0.lock().unwrap();
                    state.value = Registration::Registered("exact-command".into());
                    state.read_fails = registered_unknown;
                    state.approval = Some(approval);
                }
                let observed = service.settings(&config, "t").unwrap();
                assert_eq!(
                    observed.effective_startup == EffectiveStartup::Enabled,
                    !registered_unknown && approval == StartupApproval::Allowed
                );
            }
        }
        adapter.0.lock().unwrap().read_fails = false;
        adapter.0.lock().unwrap().approval = Some(StartupApproval::Disabled);
        service.update(&config, root.path(), true).unwrap();
        assert_eq!(
            service.settings(&config, "t").unwrap().effective_startup,
            EffectiveStartup::Disabled
        );
        adapter.0.lock().unwrap().approval_fails = true;
        let observed = service.settings(&config, "t").unwrap();
        assert_eq!(observed.effective_startup, EffectiveStartup::Unknown);
        assert!(observed.approval_error.is_some());
    }

    #[test]
    fn partial_system_failure_restores_exact_registration_before_returning() {
        let adapter = Fake::default();
        let original = Registration::Registered("old command with exact quoting".into());
        {
            let mut state = adapter.0.lock().unwrap();
            state.value = original.clone();
            state.partial_write = true;
            state.failed_sets.insert(1);
        }
        assert!(
            apply(&adapter, false, || panic!(
                "failed system write cannot persist"
            ))
            .is_err()
        );
        assert!(adapter.0.lock().unwrap().value == original);
        assert_eq!(
            adapter.0.lock().unwrap().calls,
            ["read", "set:false", "restore:true", "read"]
        );
    }
}
