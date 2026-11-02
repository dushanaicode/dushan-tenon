//! 产品翻译器；语言实时读取，双语目录由宿主装配，插值复用 framework。

use std::collections::BTreeMap;

use serde_json::{Map, Value};
use tenon_framework::{
    error::{AppError, INTERNAL_UNEXPECTED},
    i18n::{Language, Translator, render},
};

pub struct EmbeddedTranslator {
    language: Box<dyn Fn() -> Result<Language, AppError> + Send + Sync>,
    zh_cn: BTreeMap<String, String>,
    en_us: BTreeMap<String, String>,
}

impl EmbeddedTranslator {
    /// 宿主保留产品目录的 include_str! 和配置锁；锁中毒由读取闭包返回错误。
    pub fn new(
        language: impl Fn() -> Result<Language, AppError> + Send + Sync + 'static,
        zh_cn: &str,
        en_us: &str,
    ) -> Result<Self, AppError> {
        let parse = |source| {
            serde_json::from_str(source)
                .map_err(|error| AppError::new(INTERNAL_UNEXPECTED).with_source(error))
        };
        Ok(Self {
            language: Box::new(language),
            zh_cn: parse(zh_cn)?,
            en_us: parse(en_us)?,
        })
    }
}

impl Translator for EmbeddedTranslator {
    fn text(&self, key: &str, params: &Map<String, Value>) -> Result<String, AppError> {
        self.text_in((self.language)()?, key, params)
    }

    fn text_in(
        &self,
        language: Language,
        key: &str,
        params: &Map<String, Value>,
    ) -> Result<String, AppError> {
        let catalog = match language {
            Language::ZhCn => &self.zh_cn,
            Language::EnUs => &self.en_us,
        };
        render(key, params, &|key| catalog.get(key).cloned())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Mutex};

    #[test]
    fn injected_catalogs_follow_live_language() {
        let language = Arc::new(Mutex::new(Language::ZhCn));
        let read = language.clone();
        let translator = EmbeddedTranslator::new(
            move || Ok(*read.lock().unwrap()),
            r#"{"body":"{{kind}}已完成。","kind":"测量练习卡"}"#,
            r#"{"body":"{{kind}} has completed.","kind":"Measure practice cards"}"#,
        )
        .unwrap();
        let params = serde_json::json!({"kind":{"$t":"kind"}});
        let params = params.as_object().unwrap();
        assert_eq!(
            translator.text("body", params).unwrap(),
            "测量练习卡已完成。"
        );
        *language.lock().unwrap() = Language::EnUs;
        assert_eq!(
            translator.text("body", params).unwrap(),
            "Measure practice cards has completed."
        );
        assert_eq!(
            translator.text_in(Language::ZhCn, "body", params).unwrap(),
            "测量练习卡已完成。"
        );
        assert_eq!(
            translator.text("missing", params).unwrap_err().code(),
            INTERNAL_UNEXPECTED
        );
    }

    #[test]
    fn invalid_catalogs_and_language_reader_fail_without_fallback() {
        for catalog in ["broken", r#"{"key":42}"#] {
            assert!(EmbeddedTranslator::new(|| Ok(Language::ZhCn), catalog, "{}").is_err());
            assert!(EmbeddedTranslator::new(|| Ok(Language::ZhCn), "{}", catalog).is_err());
        }
        let translator = EmbeddedTranslator::new(
            || Err(AppError::new(INTERNAL_UNEXPECTED)),
            r#"{"key":"中文"}"#,
            r#"{"key":"English"}"#,
        )
        .unwrap();
        assert_eq!(
            translator.text("key", &Map::new()).unwrap_err().code(),
            INTERNAL_UNEXPECTED
        );
        assert_eq!(
            translator
                .text_in(Language::EnUs, "key", &Map::new())
                .unwrap(),
            "English"
        );
    }
}
