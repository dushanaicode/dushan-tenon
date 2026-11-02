//! UTC 毫秒时间戳；私有表示始终为有效的 jiff 时间，文本限 RFC 3339 年份，不依赖其他内核模块。

use serde::{Deserialize, Deserializer, Serialize, Serializer, de::Error};
use std::{fmt, str::FromStr};
use ts_rs::TS;

#[derive(Debug, thiserror::Error)]
pub enum ParseTimestampError {
    #[error(transparent)]
    InvalidTimestamp(#[from] jiff::Error),
    #[error("timestamp must have millisecond precision")]
    SubmillisecondTimestamp,
    #[error("RFC 3339 requires a year between 0000 and 9999")]
    NonRfc3339Year,
}

/// UTC Unix 毫秒；数据库使用 i64，IPC 使用毫秒精度的 RFC 3339 UTC 文本。
/// 受 jiff 的可表示范围限制，并拒绝 RFC 3339 无法表示的负年份。
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, TS)]
#[ts(type = "string")]
pub struct Timestamp(jiff::Timestamp);

impl Timestamp {
    pub fn now() -> Self {
        let now = jiff::Timestamp::now();
        // now 的秒、纳秒均来自有效时间戳，截断到毫秒不会超出其范围。
        Self(now - jiff::SignedDuration::from_nanos(i64::from(now.subsec_nanosecond() % 1_000_000)))
    }

    pub fn from_millis(value: i64) -> Result<Self, ParseTimestampError> {
        let timestamp = jiff::Timestamp::from_millisecond(value)?;
        if timestamp.to_zoned(jiff::tz::TimeZone::UTC).year() < 0 {
            return Err(ParseTimestampError::NonRfc3339Year);
        }
        Ok(Self(timestamp))
    }

    pub fn as_millis(self) -> i64 {
        self.0.as_millisecond()
    }
}

impl fmt::Display for Timestamp {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(formatter, "{:.3}", self.0)
    }
}

impl FromStr for Timestamp {
    type Err = ParseTimestampError;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        let timestamp: jiff::Timestamp = value.parse()?;
        if timestamp.as_nanosecond() % 1_000_000 != 0 {
            return Err(ParseTimestampError::SubmillisecondTimestamp);
        }
        Self::from_millis(timestamp.as_millisecond())
    }
}

impl Serialize for Timestamp {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.collect_str(self)
    }
}

impl<'de> Deserialize<'de> for Timestamp {
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
    fn timestamp_is_utc_rfc3339_with_exact_milliseconds() {
        for millis in [-1, 0, 1, 1_792_152_123_456] {
            let timestamp = Timestamp::from_millis(millis).unwrap();
            let text = timestamp.to_string();
            assert!(text.ends_with('Z'));
            assert_eq!(text.split('.').nth(1).unwrap().len(), 4);
            assert_eq!(text.parse::<Timestamp>().unwrap(), timestamp);
            let json = serde_json::to_string(&timestamp).unwrap();
            assert_eq!(serde_json::from_str::<Timestamp>(&json).unwrap(), timestamp);
            assert_eq!(timestamp.as_millis(), millis);
        }
        let offset: Timestamp = "2026-10-16T13:14:15.123+08:00".parse().unwrap();
        assert_eq!(offset.to_string(), "2026-10-16T05:14:15.123Z");
        let now = Timestamp::now();
        assert_eq!(now.to_string().parse::<Timestamp>().unwrap(), now);
        assert!("invalid".parse::<Timestamp>().is_err());
        assert!("2026-10-16T00:00:00.123456Z".parse::<Timestamp>().is_err());
        assert!(Timestamp::from_millis(i64::MAX).is_err());
        assert!("0000-01-01T00:00:00.000Z".parse::<Timestamp>().is_ok());
        // jiff 的毫秒构造器上限是 MAX 的整秒，不能直接使用 MAX 的纳秒尾数。
        let max_millis = jiff::Timestamp::MAX.as_second() * 1_000;
        let max = Timestamp::from_millis(max_millis).unwrap();
        assert_eq!(max.to_string().parse::<Timestamp>().unwrap(), max);
        assert!(Timestamp::from_millis(max_millis + 1).is_err());
        assert!("-000001-12-31T23:59:59.999Z".parse::<Timestamp>().is_err());
        assert!(serde_json::from_str::<Timestamp>("123").is_err());
    }

    #[test]
    fn timestamp_is_a_string_in_typescript_contracts() {
        let config = ts_rs::Config::default();
        assert_eq!(Timestamp::inline(&config), "string");
        assert_eq!(Timestamp::decl(&config), "type Timestamp = string;");
    }
}
