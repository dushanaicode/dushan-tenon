//! UUID v7 标识；只接受小写带连字符的标准文本，不依赖其他内核模块。

use serde::{Deserialize, Deserializer, Serialize, Serializer, de::Error};
use std::{fmt, str::FromStr};
use ts_rs::TS;
use uuid::Uuid;

#[derive(Debug, thiserror::Error)]
#[error("expected a lowercase hyphenated UUID v7")]
pub struct ParseIdError;

/// UUID v7；数据库与 IPC 均使用 36 位小写带连字符文本。
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, TS)]
#[ts(type = "string")]
pub struct Id(Uuid);

impl Id {
    pub fn new() -> Self {
        Self(Uuid::now_v7())
    }
}

impl Default for Id {
    fn default() -> Self {
        Self::new()
    }
}

impl fmt::Display for Id {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.0.fmt(formatter)
    }
}

impl FromStr for Id {
    type Err = ParseIdError;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        let id = Uuid::parse_str(value).map_err(|_| ParseIdError)?;
        if id.get_version() != Some(uuid::Version::SortRand)
            || id.get_variant() != uuid::Variant::RFC4122
            || value != id.to_string()
        {
            return Err(ParseIdError);
        }
        Ok(Self(id))
    }
}

impl Serialize for Id {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.collect_str(self)
    }
}

impl<'de> Deserialize<'de> for Id {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        String::deserialize(deserializer)?
            .parse()
            .map_err(D::Error::custom)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn id_is_canonical_uuid_v7_and_round_trips() {
        let id = Id::new();
        let text = id.to_string();
        assert_eq!(text.len(), 36);
        assert_eq!(text, text.to_lowercase());
        assert_eq!(uuid::Uuid::parse_str(&text).unwrap().get_version_num(), 7);
        assert_eq!(text.parse::<Id>().unwrap(), id);
        assert_eq!(serde_json::to_string(&id).unwrap(), format!("\"{id}\""));
        assert_eq!(
            serde_json::from_str::<Id>(&format!("\"{id}\"")).unwrap(),
            id
        );
        for invalid in [
            "bad-id",
            "",
            "00000000-0000-0000-0000-000000000000",
            "550e8400-e29b-41d4-a716-446655440000",
            "019A10AB-0000-7000-8000-000000000000",
            "019a10ab-0000-7000-0000-000000000000",
            "019a10ab000070008000000000000000",
        ] {
            assert!(invalid.parse::<Id>().is_err(), "{invalid}");
            assert!(serde_json::from_str::<Id>(&format!("\"{invalid}\"")).is_err());
        }
    }

    #[test]
    fn id_is_a_string_in_typescript_contracts() {
        #[derive(Serialize, Deserialize, TS)]
        struct Dto {
            id: Id,
        }
        let config = ts_rs::Config::default();
        assert_eq!(Id::inline(&config), "string");
        assert_eq!(Id::decl(&config), "type Id = string;");
        assert!(Dto::decl(&config).contains("id: Id"));
    }
}
