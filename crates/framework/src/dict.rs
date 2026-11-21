//! 字典声明、枚举与校验；值、顺序和色调共用声明，仅依赖 error，不汇总服务字典。

#[macro_export]
macro_rules! dict_enum {
    ($(#[$attr:meta])* $vis:vis enum $name:ident {
        $($variant:ident => $value:literal ($tone:ident)),+ $(,)?
    }) => {
        $(#[$attr])*
        #[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, serde::Deserialize, serde::Serialize, ts_rs::TS)]
        $vis enum $name {
            $(#[serde(rename = $value)] $variant),+
        }
        impl $name {
            pub const fn as_str(self) -> &'static str {
                match self { $(Self::$variant => $value),+ }
            }
            pub const ITEMS: &'static [$crate::dict::DictItemDeclaration] = &[
                $($crate::dict::DictItemDeclaration {
                    value: $value,
                    tone: $crate::dict::DictTone::$tone,
                }),+
            ];
        }
        impl TryFrom<String> for $name {
            type Error = $crate::error::AppError;
            fn try_from(value: String) -> Result<Self, $crate::error::AppError> {
                match value.as_str() {
                    $($value => Ok(Self::$variant),)+
                    _ => Err($crate::error::AppError::new($crate::error::INTERNAL_UNEXPECTED)),
                }
            }
        }
    };
}

dict_enum! {
    pub enum DictTone {
        Neutral => "neutral" (Neutral),
        Info => "info" (Info),
        Success => "success" (Success),
        Warning => "warning" (Warning),
        Danger => "danger" (Danger),
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct DictItemDeclaration {
    pub value: &'static str,
    pub tone: DictTone,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct DictDeclaration {
    pub code: &'static str,
    pub items: &'static [DictItemDeclaration],
}

fn valid_segment(value: &str) -> bool {
    value.starts_with(|c: char| c.is_ascii_lowercase())
        && value
            .bytes()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == b'_')
}

pub(crate) fn valid_value(value: &str) -> bool {
    value.len() <= 64 && valid_segment(value)
}

pub(crate) fn valid_code(code: &str, module: &str) -> bool {
    code.len() <= 96
        && code
            .split_once('.')
            .is_some_and(|(prefix, name)| prefix == module && name.split('.').all(valid_segment))
}

#[cfg(test)]
mod tests {
    use super::*;

    dict_enum! {
        /// 属性应透传到枚举。
        pub enum Example {
            First => "first_value" (Info),
            Second => "second" (Success),
            Error => "failure" (Danger),
        }
    }

    #[test]
    fn enum_values_serde_database_and_declaration_agree() {
        for (value, text) in [
            (Example::First, "first_value"),
            (Example::Second, "second"),
            (Example::Error, "failure"),
        ] {
            assert_eq!(value.as_str(), text);
            let json = serde_json::to_string(&value).unwrap();
            assert_eq!(json, format!("\"{text}\""));
            assert_eq!(serde_json::from_str::<Example>(&json).unwrap(), value);
            assert_eq!(Example::try_from(text.to_owned()).unwrap(), value);
        }
        assert_eq!(
            Example::try_from("unknown".to_owned()).unwrap_err().code(),
            crate::error::INTERNAL_UNEXPECTED
        );
        assert!(serde_json::from_str::<Example>("\"First\"").is_err());
        assert_eq!(
            Example::ITEMS,
            &[
                DictItemDeclaration {
                    value: "first_value",
                    tone: DictTone::Info
                },
                DictItemDeclaration {
                    value: "second",
                    tone: DictTone::Success
                },
                DictItemDeclaration {
                    value: "failure",
                    tone: DictTone::Danger
                },
            ]
        );
    }

    #[test]
    fn code_and_value_boundaries() {
        assert!(valid_value(&"a".repeat(64)));
        assert!(!valid_value(&"a".repeat(65)));
        for value in ["", "1a", "A", "a.b", "a-b", "a ", "中文"] {
            assert!(!valid_value(value), "{value}");
        }
        assert!(valid_code("sample.a.b_2", "sample"));
        assert!(valid_code(&format!("sample.{}", "a".repeat(89)), "sample"));
        assert!(!valid_code(&format!("sample.{}", "a".repeat(90)), "sample"));
        for code in [
            "sample",
            "sample.",
            "sample.a.",
            "sample..a",
            "sample.A",
            "system.a",
        ] {
            assert!(!valid_code(code, "sample"), "{code}");
        }
    }
}
