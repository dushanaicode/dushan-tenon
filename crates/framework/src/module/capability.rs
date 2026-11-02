/// 宿主装配的内核能力；区别于专指前端权限的 Tauri WebView capability。
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub enum Capability {
    Job,
    Exchange,
    File,
}

impl Capability {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Job => "job",
            Self::Exchange => "exchange",
            Self::File => "file",
        }
    }
}

impl super::ModuleRegistry {
    /// 仅检查已启用模块；宿主须在启动任何模块之前调用。
    pub fn check_capabilities(&self, available: &[Capability]) -> Result<(), super::RegistryError> {
        for &index in &self.order {
            if !self.enabled[index] {
                continue;
            }
            let declaration = self.modules[index].declaration();
            for &capability in declaration.required_capabilities {
                if !available.contains(&capability) {
                    return Err(super::RegistryError::CapabilityUnavailable {
                        module: declaration.id.into(),
                        capability,
                    });
                }
            }
        }
        Ok(())
    }
}
