//! 模块声明的运行时业务参数；秘密只存凭据库。

use std::collections::BTreeSet;

use serde::Serialize;
use ts_rs::TS;

use crate::{dict, time::Timestamp};

mod store;
pub use store::ParamStore;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, TS)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum ParamKind {
    Text {
        max_chars: usize,
    },
    Integer {
        #[ts(type = "number")]
        min: i64,
        #[ts(type = "number")]
        max: i64,
    },
    Boolean,
    Choice {
        values: &'static [&'static str],
    },
    Secret,
}

impl ParamKind {
    fn valid_value(self, value: &str) -> bool {
        match self {
            Self::Text { max_chars } => {
                value.chars().count() <= max_chars && !value.chars().any(char::is_control)
            }
            Self::Integer { min, max } => {
                value.parse::<i64>().is_ok_and(|v| (min..=max).contains(&v))
            }
            Self::Boolean => matches!(value, "true" | "false"),
            Self::Choice { values } => values.contains(&value),
            Self::Secret => !value.is_empty() && value.chars().count() <= 4096,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub enum ParamEffect {
    NextRead,
    NextJob,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub enum ParamSource {
    Default,
    Database,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ParamDeclaration {
    pub key: &'static str,
    pub kind: ParamKind,
    pub default: &'static str,
    pub group: &'static str,
    pub order: i32,
    pub read_permission: Option<&'static str>,
    pub write_permission: Option<&'static str>,
    pub effect: ParamEffect,
}

impl ParamDeclaration {
    pub(crate) fn valid(self, module: &str, permissions: &[&str]) -> bool {
        if !dict::valid_code(self.key, module)
            || !dict::valid_code(self.group, module)
            || self.order < 0
            || [self.read_permission, self.write_permission]
                .into_iter()
                .flatten()
                .any(|permission| !permissions.contains(&permission))
        {
            return false;
        }
        match self.kind {
            ParamKind::Text { max_chars } if !(1..=1024).contains(&max_chars) => return false,
            ParamKind::Integer { min, max }
                if min > max || min < -9_007_199_254_740_991 || max > 9_007_199_254_740_991 =>
            {
                return false;
            }
            ParamKind::Choice { values } => {
                let mut seen = BTreeSet::new();
                if values.is_empty()
                    || values.iter().any(|v| {
                        v.len() > 64 || !v.split('-').all(dict::valid_value) || !seen.insert(v)
                    })
                {
                    return false;
                }
            }
            ParamKind::Secret => return self.default.is_empty(),
            _ => {}
        }
        self.kind.valid_value(self.default)
    }
}

/// 管理列表的公开状态，秘密的 value/default 始终为 None。
#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct ParamEntry {
    pub key: String,
    pub module_id: String,
    pub kind: ParamKind,
    pub value: Option<String>,
    pub default: Option<String>,
    pub is_default: bool,
    pub secret_set: bool,
    #[ts(type = "number | null")]
    pub row_version: Option<i64>,
    pub updated_at: Option<Timestamp>,
    pub group: String,
    pub order: i32,
    pub read_permission: Option<String>,
    pub write_permission: Option<String>,
    pub effect: ParamEffect,
    pub source: ParamSource,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn declaration_bounds_defaults_and_javascript_safe_integers_are_checked() {
        let integer = ParamDeclaration {
            key: "test.integer",
            kind: ParamKind::Integer {
                min: -9_007_199_254_740_991,
                max: 9_007_199_254_740_991,
            },
            default: "9007199254740991",
            group: "test.settings",
            order: 0,
            read_permission: None,
            write_permission: None,
            effect: ParamEffect::NextRead,
        };
        assert!(integer.valid("test", &[]));
        assert!(
            ParamDeclaration {
                default: "-9007199254740991",
                ..integer
            }
            .valid("test", &[])
        );
        for kind in [
            ParamKind::Integer {
                min: -9_007_199_254_740_992,
                max: 9_007_199_254_740_991,
            },
            ParamKind::Integer {
                min: 0,
                max: 9_007_199_254_740_992,
            },
            ParamKind::Integer { min: 2, max: 1 },
            ParamKind::Text { max_chars: 0 },
            ParamKind::Text { max_chars: 1025 },
            ParamKind::Choice { values: &[] },
        ] {
            assert!(!ParamDeclaration { kind, ..integer }.valid("test", &[]));
        }
        assert!(
            !ParamDeclaration {
                kind: ParamKind::Secret,
                ..integer
            }
            .valid("test", &[])
        );
        assert!(
            ParamDeclaration {
                kind: ParamKind::Secret,
                default: "",
                ..integer
            }
            .valid("test", &[])
        );
    }

    #[test]
    fn choice_declarations_accept_hyphenated_values_and_reject_invalid_or_duplicate_values() {
        for (values, valid) in [
            (&["bottom-right", "top-left", "old_value"][..], true),
            (&["bottom--right"][..], false),
            (&["-right"][..], false),
            (&["bottom-"][..], false),
            (&["Top-right"][..], false),
            (&["bottom right"][..], false),
            (&["bottom-right", "bottom-right"][..], false),
        ] {
            let declaration = ParamDeclaration {
                key: "test.position",
                kind: ParamKind::Choice { values },
                default: values[0],
                group: "test.preferences",
                order: 10,
                read_permission: None,
                write_permission: None,
                effect: ParamEffect::NextRead,
            };
            assert_eq!(declaration.valid("test", &[]), valid, "{values:?}");
        }
    }
}
