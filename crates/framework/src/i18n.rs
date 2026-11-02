//! 翻译端口、语言与单次插值；文案资源由宿主提供，参数不会二次解释，仅依赖 error。
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use ts_rs::TS;

use crate::error::{AppError, INTERNAL_UNEXPECTED};

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq, Eq, TS)]
pub enum Language {
    #[default]
    #[serde(rename = "zh-CN")]
    ZhCn,
    #[serde(rename = "en-US")]
    EnUs,
}

pub trait Translator: Send + Sync {
    fn text(&self, key: &str, params: &Map<String, Value>) -> Result<String, AppError>;
    fn text_in(
        &self,
        language: Language,
        key: &str,
        params: &Map<String, Value>,
    ) -> Result<String, AppError>;
}

/// 与资源文案共用的单次插值；插入值不会再次被解释为模板。
fn interpolate(
    template: &str,
    mut value: impl FnMut(&str) -> Result<String, AppError>,
) -> Result<String, AppError> {
    let mut rest = template;
    let mut output = String::new();
    while let Some((before, after)) = rest.split_once("{{") {
        output.push_str(before);
        let (name, tail) = after
            .split_once("}}")
            .ok_or_else(|| AppError::new(INTERNAL_UNEXPECTED))?;
        output.push_str(&value(name.trim())?);
        rest = tail;
    }
    output.push_str(rest);
    Ok(output)
}

/// 只展开模板实际使用的参数，引用共享同一组参数；插入的字符串不再作为模板解析。
pub fn render(
    key: &str,
    params: &Map<String, Value>,
    lookup: &dyn Fn(&str) -> Option<String>,
) -> Result<String, AppError> {
    fn expand(
        key: &str,
        params: &Map<String, Value>,
        lookup: &dyn Fn(&str) -> Option<String>,
        stack: &mut Vec<String>,
    ) -> Result<String, AppError> {
        let invalid = || AppError::new(INTERNAL_UNEXPECTED);
        if stack.iter().any(|entry| entry == key) {
            return Err(invalid());
        }
        let template = lookup(key).ok_or_else(invalid)?;
        stack.push(key.into());
        let output = interpolate(&template, |name| {
            Ok(match params.get(name).ok_or_else(invalid)? {
                Value::String(value) => value.clone(),
                Value::Number(value) => value.to_string(),
                Value::Object(reference) if reference.len() == 1 => {
                    let key = reference
                        .get("$t")
                        .and_then(Value::as_str)
                        .ok_or_else(invalid)?;
                    expand(key, params, lookup, stack)?
                }
                _ => return Err(invalid()),
            })
        })?;
        stack.pop();
        Ok(output)
    }
    expand(key, params, lookup, &mut Vec::new())
}

#[cfg(any(test, feature = "test-support"))]
pub struct TestTranslator;

#[cfg(any(test, feature = "test-support"))]
impl Translator for TestTranslator {
    fn text(&self, key: &str, _: &Map<String, Value>) -> Result<String, AppError> {
        Ok(key.into())
    }
    fn text_in(
        &self,
        _: Language,
        key: &str,
        params: &Map<String, Value>,
    ) -> Result<String, AppError> {
        self.text(key, params)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn interpolation_references_and_contract_errors() {
        let lookup = |key: &str| match key {
            "body" => Some("{{ kind }}: {{count}} — {{error}} / {{kind}}".into()),
            "kind" => Some("清理".into()),
            "error" => Some("无权限 {{permission}}".into()),
            "literal" => Some("{{value}}".into()),
            "cycle" => Some("{{error}}".into()),
            _ => None,
        };
        let params = json!({"kind":{"$t":"kind"}, "count":2.5, "error":{"$t":"error"}, "permission":"sample.log.manage"});
        assert_eq!(
            render("body", params.as_object().unwrap(), &lookup).unwrap(),
            "清理: 2.5 — 无权限 sample.log.manage / 清理"
        );
        assert_eq!(
            render(
                "literal",
                json!({"value":"{{raw}} <&>"}).as_object().unwrap(),
                &lookup
            )
            .unwrap(),
            "{{raw}} <&>"
        );
        for (key, params) in [
            ("missing", json!({})),
            ("body", json!({})),
            ("literal", json!({"value":true})),
            ("literal", json!({"value":{"$t":"missing"}})),
            ("cycle", json!({"error":{"$t":"cycle"}})),
        ] {
            assert_eq!(
                render(key, params.as_object().unwrap(), &lookup)
                    .unwrap_err()
                    .code(),
                INTERNAL_UNEXPECTED
            );
        }
    }
}
