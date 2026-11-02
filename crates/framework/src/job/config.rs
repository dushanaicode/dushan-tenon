use crate::error::{AppError, INPUT_INVALID};

/// 已校验的执行器限制；原始配置及默认策略由调用方提供。
#[derive(Clone, Copy, Debug)]
pub struct JobsConfig {
    max_concurrency: usize,
    lease_seconds: u64,
}

impl JobsConfig {
    pub fn new(max_concurrency: usize, lease_seconds: u64) -> Result<Self, AppError> {
        if !(1..=64).contains(&max_concurrency) || !(10..=600).contains(&lease_seconds) {
            return Err(AppError::new(INPUT_INVALID));
        }
        Ok(Self {
            max_concurrency,
            lease_seconds,
        })
    }

    pub fn max_concurrency(self) -> usize {
        self.max_concurrency
    }
    pub fn lease_seconds(self) -> u64 {
        self.lease_seconds
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn executor_limits_are_validated_at_construction() {
        for (concurrency, lease) in [(1, 10), (64, 600), (4, 30)] {
            let config = JobsConfig::new(concurrency, lease).unwrap();
            assert_eq!(config.max_concurrency(), concurrency);
            assert_eq!(config.lease_seconds(), lease);
        }
        for (concurrency, lease) in [(0, 30), (65, 30), (4, 9), (4, 601)] {
            assert_eq!(
                JobsConfig::new(concurrency, lease).unwrap_err().code(),
                INPUT_INVALID
            );
        }
    }
}
