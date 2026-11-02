use std::sync::Arc;

use tenon_desktop::i18n::EmbeddedTranslator;
use tenon_framework::{error::AppError, i18n::Translator};

use crate::{ports, state::SharedConfig};

pub(crate) fn translator(config: SharedConfig) -> Result<Arc<dyn Translator>, AppError> {
    Ok(Arc::new(EmbeddedTranslator::new(
        move || Ok(ports::read(&config)?.language()),
        include_str!("../../src/core/i18n/zh-CN.json"),
        include_str!("../../src/core/i18n/en-US.json"),
    )?))
}
