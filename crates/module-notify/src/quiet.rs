//! 本地整点免打扰窗口；调用方提供已校验为 0..=23 的小时。

use tenon_framework::time::Timestamp;

pub(super) fn in_window(hour: i64, start: i64, end: i64) -> bool {
    if start < end {
        (start..end).contains(&hour)
    } else {
        hour >= start || hour < end
    }
}

/// 时间由调用方注入，系统时区与调度器使用同一 jiff 实现。
#[expect(
    clippy::expect_used,
    reason = "Timestamp 的私有表示已验证同一 jiff 时间范围，毫秒往返保持有效"
)]
pub(super) fn local_hour(now: Timestamp) -> i64 {
    i64::from(
        jiff::Timestamp::from_millisecond(now.as_millis())
            .expect("Timestamp constructors validate the jiff range")
            .to_zoned(jiff::tz::TimeZone::system())
            .hour(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_hour_and_window_matches_forward_clock_walk() {
        for start in 0..24 {
            for end in 0..24 {
                let length = if start == end {
                    24
                } else {
                    (end - start + 24) % 24
                };
                let hours = (0..length)
                    .map(|offset| (start + offset) % 24)
                    .collect::<Vec<_>>();
                for hour in 0..24 {
                    assert_eq!(
                        in_window(hour, start, end),
                        hours.contains(&hour),
                        "{hour}: {start}..{end}"
                    );
                }
                assert!(in_window(start, start, end));
                assert_eq!(in_window(end, start, end), start == end);
            }
        }
    }

    #[test]
    fn injected_timestamp_uses_system_local_hour() {
        let time = jiff::civil::date(2026, 10, 23)
            .at(22, 30, 0, 0)
            .to_zoned(jiff::tz::TimeZone::system())
            .unwrap();
        let now = Timestamp::from_millis(time.timestamp().as_millisecond()).unwrap();
        assert_eq!(local_hour(now), 22);
        assert!(in_window(local_hour(now), 22, 8));
    }
}
