//! 文件管理业务入口；宿主解析文件选择令牌后传入路径。

use tenon_framework::module::{Capability, Module, ModuleContext, ModuleDeclaration, ModuleFuture};
pub mod file;

pub const DECLARATION: ModuleDeclaration = ModuleDeclaration {
    id: "files",
    version: env!("CARGO_PKG_VERSION"),
    dependencies: &["account"],
    required_capabilities: &[Capability::File],
    core: false,
    migrations: &[],
    error_codes: &[],
    permissions: &["files.file.read", "files.file.write"],
    file_purposes: &[tenon_framework::file::FilePurposeDeclaration {
        code: "files.attachment",
        extensions: tenon_framework::file::KNOWN_EXTENSIONS,
    }],
    params: &[],
    job_kinds: &[],
    schedules: &[],
    message_keys: &[],
    dictionaries: &[],
};

pub struct FilesModule;
impl Module for FilesModule {
    fn declaration(&self) -> &ModuleDeclaration {
        &DECLARATION
    }
    fn start<'a>(&'a self, _: ModuleContext<'a>) -> ModuleFuture<'a> {
        Box::pin(async { Ok(()) })
    }
    fn stop(&self) -> ModuleFuture<'_> {
        Box::pin(async { Ok(()) })
    }
}

#[cfg(test)]
mod db;
