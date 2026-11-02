//! 六模块的显式装配目录；CLI 和合同工具直接读取声明，无需构造服务。

use std::{collections::BTreeMap, sync::Arc};
use tenon_framework::module::{ModuleDeclaration, ModuleRegistry, RegistryError};
use tenon_module_account::AccountService;
use tenon_module_ai::AiService;
use tenon_module_demo::DemoService;
use tenon_module_notify::NotifyService;

pub const DECLARATIONS: [&ModuleDeclaration; 6] = [
    &tenon_module_account::DECLARATION,
    &tenon_module_notify::DECLARATION,
    &tenon_module_files::DECLARATION,
    &tenon_module_devtools::DECLARATION,
    &tenon_module_ai::DECLARATION,
    &tenon_module_demo::DECLARATION,
];

pub fn registry(
    account: Arc<AccountService>,
    notify: Arc<NotifyService>,
    ai: Arc<AiService>,
    demo: Arc<DemoService>,
    settings: &BTreeMap<String, bool>,
) -> Result<ModuleRegistry, RegistryError> {
    ModuleRegistry::new(
        vec![
            account,
            notify,
            Arc::new(tenon_module_files::FilesModule),
            Arc::new(tenon_module_devtools::DevtoolsModule),
            ai,
            demo,
        ],
        settings,
    )
}
