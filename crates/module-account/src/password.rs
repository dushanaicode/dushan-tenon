use argon2::{
    Argon2, Params,
    password_hash::{self, PasswordHasher, PasswordVerifier, phc::PasswordHash},
};
use secrecy::{ExposeSecret, SecretString};
use tenon_framework::{
    error::{AppError, INTERNAL_UNEXPECTED},
    id::Id,
};

use crate::PASSWORD_INVALID;

// 应用唯一生成档：等于 Argon2::default() 的 Argon2id（OWASP 最低推荐）及 DUMMY_HASH 参数。
const ARGON2_MEMORY_KIB: u32 = 19_456;
const ARGON2_ITERATIONS: u32 = 2;
const ARGON2_PARALLELISM: u32 = 1;

// 默认 Argon2id 参数的固定假 PHC；未设置口令时也完成相同成本的密码校验。
const DUMMY_HASH: &str = "$argon2id$v=19$m=19456,t=2,p=1$MDEyMzQ1Njc4OWFiY2RlZg$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const ALPHABET: &[u8; 32] = b"0123456789ABCDEFGHJKMNPQRSTVWXYZ";

pub(super) fn validate(password: &str) -> Result<(), AppError> {
    if !(8..=128).contains(&password.chars().count()) || password.chars().all(char::is_whitespace) {
        return Err(AppError::new(PASSWORD_INVALID)
            .with_param("min", "8")
            .with_param("max", "128"));
    }
    Ok(())
}

fn hash(password: &str) -> Result<String, AppError> {
    Argon2::default()
        .hash_password(password.as_bytes())
        .map(|hash| hash.to_string())
        .map_err(|_| AppError::new(INTERNAL_UNEXPECTED))
}

pub(super) struct Credentials {
    pub(super) password_hash: String,
    pub(super) codes: Vec<String>,
    pub(super) hashes: Vec<String>,
}

pub(super) struct RecoverySecrets {
    pub(super) codes: Vec<String>,
    pub(super) hashes: Vec<String>,
}

fn create_codes() -> Result<RecoverySecrets, AppError> {
    let mut codes = Vec::with_capacity(10);
    let mut hashes = Vec::with_capacity(10);
    for _ in 0..10 {
        let mut bytes = [0_u8; 16];
        getrandom::fill(&mut bytes).map_err(|_| AppError::new(INTERNAL_UNEXPECTED))?;
        let mut code = String::with_capacity(19);
        for (index, byte) in bytes.into_iter().enumerate() {
            if index > 0 && index % 4 == 0 {
                code.push('-');
            }
            code.push(ALPHABET[usize::from(byte & 31)] as char);
        }
        hashes.push(hash(&code)?);
        codes.push(code);
    }
    Ok(RecoverySecrets { codes, hashes })
}

pub(super) async fn create(password: SecretString) -> Result<Credentials, AppError> {
    validate(password.expose_secret())?;
    tokio::task::spawn_blocking(move || {
        let password_hash = hash(password.expose_secret())?;
        let RecoverySecrets { codes, hashes } = create_codes()?;
        Ok(Credentials {
            password_hash,
            codes,
            hashes,
        })
    })
    .await
    .map_err(|_| AppError::new(INTERNAL_UNEXPECTED))?
}

pub(super) async fn regenerate() -> Result<RecoverySecrets, AppError> {
    tokio::task::spawn_blocking(create_codes)
        .await
        .map_err(|_| AppError::new(INTERNAL_UNEXPECTED))?
}

pub async fn hash_password(password: SecretString) -> Result<SecretString, AppError> {
    validate(password.expose_secret())?;
    tokio::task::spawn_blocking(move || hash(password.expose_secret()).map(SecretString::from))
        .await
        .map_err(|_| AppError::new(INTERNAL_UNEXPECTED))?
}

fn normalize_recovery(code: &str) -> Option<String> {
    let compact: String = code
        .chars()
        .filter(|ch| !ch.is_whitespace() && *ch != '-')
        .map(|ch| ch.to_ascii_uppercase())
        .collect();
    if compact.len() != 16 || !compact.bytes().all(|byte| ALPHABET.contains(&byte)) {
        return None;
    }
    Some(format!(
        "{}-{}-{}-{}",
        &compact[..4],
        &compact[4..8],
        &compact[8..12],
        &compact[12..]
    ))
}

/// 固定校验十次，避免通过耗时泄露剩余码数或匹配位置。
pub(super) async fn verify_recovery(
    code: SecretString,
    hashes: Vec<(Id, String)>,
) -> Result<Option<Id>, AppError> {
    tokio::task::spawn_blocking(move || {
        let normalized = normalize_recovery(code.expose_secret());
        let mut matched = None;
        for index in 0..10 {
            let candidate = normalized.as_ref().and_then(|_| hashes.get(index));
            if verify_hash(
                normalized.as_deref().unwrap_or(code.expose_secret()),
                candidate.map(|(_, hash)| hash.as_str()),
            )? && matched.is_none()
            {
                matched = candidate.map(|(id, _)| *id);
            }
        }
        Ok(matched)
    })
    .await
    .map_err(|_| AppError::new(INTERNAL_UNEXPECTED))?
}

fn within_policy(hash: &str) -> bool {
    let Ok(hash) = PasswordHash::new(hash) else {
        return false;
    };
    hash.algorithm.as_str() == "argon2id"
        && hash.version == Some(0x13)
        && Params::try_from(&hash).is_ok_and(|params| {
            params.m_cost() == ARGON2_MEMORY_KIB
                && params.t_cost() == ARGON2_ITERATIONS
                && params.p_cost() == ARGON2_PARALLELISM
        })
}

pub(super) fn check_restored_hash(hash: &str) -> Result<(), AppError> {
    if !within_policy(hash) {
        return Err(AppError::new(tenon_framework::backup::INVALID_ARCHIVE));
    }
    Ok(())
}

fn verify_hash(password: &str, hash: Option<&str>) -> Result<bool, AppError> {
    if hash.is_some_and(|hash| !within_policy(hash)) {
        return Ok(false);
    }
    match Argon2::default().verify_password(password.as_bytes(), hash.unwrap_or(DUMMY_HASH)) {
        Ok(()) => Ok(hash.is_some()),
        Err(password_hash::Error::PasswordInvalid) => Ok(false),
        Err(_) => Err(AppError::new(INTERNAL_UNEXPECTED)),
    }
}

pub(super) async fn verify(password: SecretString, hash: Option<String>) -> Result<bool, AppError> {
    tokio::task::spawn_blocking(move || verify_hash(password.expose_secret(), hash.as_deref()))
        .await
        .map_err(|_| AppError::new(INTERNAL_UNEXPECTED))?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_argon2_costs_match_policy() {
        let argon2 = Argon2::default();
        assert_eq!(argon2.params().m_cost(), ARGON2_MEMORY_KIB);
        assert_eq!(argon2.params().t_cost(), ARGON2_ITERATIONS);
        assert_eq!(argon2.params().p_cost(), ARGON2_PARALLELISM);
    }

    #[test]
    fn policy_accepts_generated_and_dummy_hashes() {
        assert!(within_policy(&hash("password").unwrap()));
        assert!(within_policy(DUMMY_HASH));
    }

    #[test]
    fn policy_rejects_other_profiles_and_malformed_phc() {
        for (from, to) in [
            ("m=19456", "m=65536"),
            ("m=19456", "m=8"),
            ("t=2", "t=3"),
            ("t=2", "t=1"),
            ("p=1", "p=2"),
            ("p=1", "p=0"),
            ("argon2id", "argon2i"),
            ("argon2id", "argon2d"),
            ("v=19", "v=16"),
            ("v=19$", ""),
            ("m=19456", "m=invalid"),
        ] {
            assert!(!within_policy(&DUMMY_HASH.replace(from, to)), "{to}");
        }
        assert!(!within_policy("not a PHC hash"));
        assert!(!within_policy(""));
    }

    #[test]
    fn verify_hash_rejects_extreme_costs_before_kdf() {
        for (from, to) in [("m=19456", "m=4294967295"), ("t=2", "t=4294967295")] {
            let hash = DUMMY_HASH.replace(from, to);
            assert!(!within_policy(&hash));
            assert!(matches!(verify_hash("password", Some(&hash)), Ok(false)));
        }
    }

    #[test]
    fn verify_hash_rejects_malformed_phc_before_kdf() {
        for hash in ["not a PHC hash", ""] {
            assert!(matches!(verify_hash("password", Some(hash)), Ok(false)));
        }
    }

    #[test]
    fn verify_hash_preserves_password_and_dummy_results() {
        let hash = hash("password").unwrap();
        assert!(verify_hash("password", Some(&hash)).unwrap());
        assert!(!verify_hash("incorrect", Some(&hash)).unwrap());
        assert!(!verify_hash("password", None).unwrap());
    }

    #[tokio::test(flavor = "current_thread")]
    async fn recovery_matches_first_and_tenth_codes_and_keeps_first_match() {
        let code = "0123-4567-89AB-CDEF";
        let matching = hash(code).unwrap();
        let other = hash("FEDC-BA98-7654-3210").unwrap();
        for position in [0, 9] {
            let mut hashes: Vec<_> = (0..10).map(|_| (Id::new(), other.clone())).collect();
            let id = hashes[position].0;
            hashes[position].1 = matching.clone();
            assert_eq!(
                verify_recovery(code.into(), hashes).await.unwrap(),
                Some(id)
            );
        }
        let first = Id::new();
        assert_eq!(
            verify_recovery(
                code.into(),
                vec![(first, matching.clone()), (Id::new(), matching)],
            )
            .await
            .unwrap(),
            Some(first)
        );
    }

    #[tokio::test(flavor = "current_thread")]
    async fn recovery_rejects_missing_codes_and_invalid_format() {
        assert_eq!(
            verify_recovery("0123-4567-89AB-CDEF".into(), Vec::new())
                .await
                .unwrap(),
            None
        );
        assert_eq!(
            verify_recovery(
                "invalid".into(),
                vec![(Id::new(), hash("invalid").unwrap())],
            )
            .await
            .unwrap(),
            None
        );
    }
}
