use std::time::Duration;

use ab_glyph::{Font, FontRef, PxScale};
use base64::{Engine, engine::general_purpose::STANDARD};
use serde::{Deserialize, Serialize};
use tenon_framework::{
    cache::Cache,
    error::{AppError, INTERNAL_UNEXPECTED},
};
use ts_rs::TS;
use uuid::Uuid;

use crate::AccountService;

const NAMESPACE: &str = "account.captcha";
const TTL: Duration = Duration::from_secs(120);
const ALPHABET: &[u8] = b"23456789ABCDEFGHJKMNPQRSTUVWXYZ";
const WIDTH: usize = 160;
const HEIGHT: usize = 56;

#[derive(Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct CaptchaAnswer {
    pub id: String,
    pub answer: String,
}

#[derive(Serialize, TS)]
pub struct CaptchaChallenge {
    pub id: String,
    pub image: String,
}

impl AccountService {
    pub async fn captcha(&self) -> Result<CaptchaChallenge, AppError> {
        self.started()?;
        let (answer, png) = tokio::task::spawn_blocking(generate)
            .await
            .map_err(|_| AppError::new(INTERNAL_UNEXPECTED))??;
        let id = Uuid::new_v4().to_string();
        self.started()?
            .cache
            .set(NAMESPACE, &id, answer.as_bytes(), TTL)
            .await?;
        Ok(CaptchaChallenge {
            id,
            image: format!("data:image/png;base64,{}", STANDARD.encode(png)),
        })
    }
}

pub(super) async fn verify(cache: &Cache, input: CaptchaAnswer) -> Result<bool, AppError> {
    // 拒绝外部非法键，不将缓存命名约束错误暴露为内部故障。
    let Ok(id) = Uuid::parse_str(&input.id) else {
        return Ok(false);
    };
    if id.get_version_num() != 4 || id.to_string() != input.id {
        return Ok(false);
    }
    // 缓存没有 GETDEL；复用已有的本机/Redis 锁，使读和删除在跨实例并发下仍一次性。
    let Some(guard) = cache
        .try_lock(&format!("{NAMESPACE}.{}", input.id), TTL)
        .await?
    else {
        return Ok(false);
    };
    let result =
        async {
            let answer = cache.get(NAMESPACE, &input.id).await?;
            cache.delete(NAMESPACE, &input.id).await?;
            Ok(answer
                .is_some_and(|answer| answer.eq_ignore_ascii_case(input.answer.trim().as_bytes())))
        }
        .await;
    guard.release().await?;
    result
}

// 仅用于视觉扰动。答案独立使用系统随机源，不从此 PRNG 派生。
struct Noise(u64);
impl Noise {
    fn below(&mut self, limit: u32) -> u32 {
        self.0 = self.0.wrapping_add(0x9e3779b97f4a7c15);
        let mut value = self.0;
        value = (value ^ (value >> 30)).wrapping_mul(0xbf58476d1ce4e5b9);
        value = (value ^ (value >> 27)).wrapping_mul(0x94d049bb133111eb);
        ((value ^ (value >> 31)) % u64::from(limit)) as u32
    }
}

fn generate() -> Result<(String, Vec<u8>), AppError> {
    let mut answer = String::with_capacity(5);
    while answer.len() < 5 {
        let mut byte = [0];
        getrandom::fill(&mut byte).map_err(|_| AppError::new(INTERNAL_UNEXPECTED))?;
        // 拒绝尾部余数，避免非二次幂字母表的取模偏差。
        if usize::from(byte[0]) < 256 - 256 % ALPHABET.len() {
            answer.push(ALPHABET[usize::from(byte[0]) % ALPHABET.len()] as char);
        }
    }
    let mut seed = [0; 8];
    getrandom::fill(&mut seed).map_err(|_| AppError::new(INTERNAL_UNEXPECTED))?;
    let mut noise = Noise(u64::from_le_bytes(seed));
    let font = FontRef::try_from_slice(include_bytes!("../assets/fonts/JetBrainsMono-Bold.ttf"))
        .map_err(|_| AppError::new(INTERNAL_UNEXPECTED))?;
    let mut pixels = vec![247_u8; WIDTH * HEIGHT * 3];
    for _ in 0..4 + noise.below(3) {
        let start = (
            noise.below(WIDTH as u32) as i32,
            noise.below(HEIGHT as u32) as i32,
        );
        let end = (
            noise.below(WIDTH as u32) as i32,
            noise.below(HEIGHT as u32) as i32,
        );
        let steps = (end.0 - start.0).abs().max((end.1 - start.1).abs()).max(1);
        let shade = 130 + noise.below(60) as u8;
        for step in 0..=steps {
            let x = start.0 + (end.0 - start.0) * step / steps;
            let y = start.1 + (end.1 - start.1) * step / steps;
            pixels[(y as usize * WIDTH + x as usize) * 3..][..3].fill(shade);
        }
    }
    for (index, ch) in answer.chars().enumerate() {
        let scale = PxScale::from(28.0 + noise.below(9) as f32);
        let glyph = font.glyph_id(ch).with_scale(scale);
        let outlined = font
            .outline_glyph(glyph)
            .ok_or_else(|| AppError::new(INTERNAL_UNEXPECTED))?;
        let bounds = outlined.px_bounds();
        let width = bounds.width() as usize;
        let height = bounds.height() as usize;
        let mut mask = vec![0_f32; width * height];
        outlined.draw(|x, y, coverage| {
            mask[y as usize * width + x as usize] = coverage;
        });
        let angle = (noise.below(51) as f32 - 25.0).to_radians();
        let (sin, cos) = angle.sin_cos();
        let center_x = 22.0 + index as f32 * 29.0;
        let center_y = 28.0 + noise.below(9) as f32 - 4.0;
        let shade = 25 + noise.below(55) as u8;
        // 逆向映射并双线性采样，旋转后保留栅格化的抗锯齿边缘。
        for y in 0..HEIGHT {
            for x in 0..WIDTH {
                let dx = x as f32 - center_x;
                let dy = y as f32 - center_y;
                let source_x = cos * dx + sin * dy + width as f32 / 2.0;
                let source_y = -sin * dx + cos * dy + height as f32 / 2.0;
                let left = source_x.floor() as i32;
                let top = source_y.floor() as i32;
                let mut alpha = 0.0;
                for row in 0..2 {
                    for col in 0..2 {
                        let mx = left + col;
                        let my = top + row;
                        if (0..width as i32).contains(&mx) && (0..height as i32).contains(&my) {
                            alpha += mask[my as usize * width + mx as usize]
                                * (1.0 - (source_x - mx as f32).abs())
                                * (1.0 - (source_y - my as f32).abs());
                        }
                    }
                }
                for channel in &mut pixels[(y * WIDTH + x) * 3..][..3] {
                    *channel =
                        (f32::from(*channel) * (1.0 - alpha) + f32::from(shade) * alpha) as u8;
                }
            }
        }
    }
    for _ in 0..100 {
        let index = noise.below((WIDTH * HEIGHT) as u32) as usize * 3;
        pixels[index..][..3].fill(90 + noise.below(120) as u8);
    }
    let mut bytes = Vec::new();
    {
        let mut encoder = png::Encoder::new(&mut bytes, WIDTH as u32, HEIGHT as u32);
        encoder.set_color(png::ColorType::Rgb);
        encoder.set_depth(png::BitDepth::Eight);
        let mut writer = encoder
            .write_header()
            .map_err(|_| AppError::new(INTERNAL_UNEXPECTED))?;
        writer
            .write_image_data(&pixels)
            .map_err(|_| AppError::new(INTERNAL_UNEXPECTED))?;
        writer
            .finish()
            .map_err(|_| AppError::new(INTERNAL_UNEXPECTED))?;
    }
    Ok((answer, bytes))
}

#[cfg(test)]
mod db {
    use super::*;

    #[test]
    fn generated_answer_and_png_follow_contract() {
        let (answer, bytes) = generate().unwrap();
        assert_eq!(answer.len(), 5);
        assert!(answer.bytes().all(|byte| ALPHABET.contains(&byte)));
        let mut reader = png::Decoder::new(std::io::Cursor::new(bytes))
            .read_info()
            .unwrap();
        let mut pixels = vec![0; reader.output_buffer_size().unwrap()];
        let frame = reader.next_frame(&mut pixels).unwrap();
        assert_eq!((frame.width, frame.height), (160, 56));
        assert!(pixels.iter().any(|value| *value < 90));
    }

    #[test]
    #[ignore = "显式设置 TEMP 到任务目录后生成供人工目测的样图"]
    fn write_captcha_sample() {
        let (_, bytes) = generate().unwrap();
        std::fs::write(std::env::temp_dir().join("captcha-sample.png"), bytes).unwrap();
    }
}
