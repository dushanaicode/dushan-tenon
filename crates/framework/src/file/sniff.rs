pub(super) const HEAD_BYTES: usize = 64 * 1024;

/// 返回完整 UTF-8 前缀；只有采样边界上的未完成字符可截掉。
pub(super) fn text_prefix(head: &[u8]) -> Option<&str> {
    match std::str::from_utf8(head) {
        Ok(text) => Some(text),
        Err(error) if error.error_len().is_none() && head.len() == HEAD_BYTES => {
            std::str::from_utf8(&head[..error.valid_up_to()]).ok()
        }
        Err(_) => None,
    }
}

#[derive(Clone, Copy)]
pub(super) enum Extension {
    Png,
    Jpeg,
    Gif,
    Webp,
    Pdf,
    Xlsx,
    Text,
}

impl Extension {
    pub(super) fn parse(extension: &str) -> Option<Self> {
        match extension {
            "png" => Some(Self::Png),
            "jpg" | "jpeg" => Some(Self::Jpeg),
            "gif" => Some(Self::Gif),
            "webp" => Some(Self::Webp),
            "pdf" => Some(Self::Pdf),
            "xlsx" => Some(Self::Xlsx),
            "txt" | "md" | "csv" | "json" => Some(Self::Text),
            _ => None,
        }
    }
}

pub(super) fn sniff(extension: Extension, head: &[u8]) -> bool {
    match extension {
        Extension::Png => head.starts_with(b"\x89PNG\r\n\x1a\n"),
        Extension::Jpeg => head.starts_with(b"\xff\xd8\xff"),
        Extension::Gif => head.starts_with(b"GIF87a") || head.starts_with(b"GIF89a"),
        Extension::Webp => head.starts_with(b"RIFF") && head.get(8..12) == Some(b"WEBP"),
        Extension::Pdf => head.starts_with(b"%PDF-"),
        Extension::Xlsx => head.starts_with(b"PK\x03\x04"),
        Extension::Text => text_prefix(head).is_some(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn signatures_and_utf8_boundaries() {
        for (extension, good) in [
            ("png", b"\x89PNG\r\n\x1a\n".as_slice()),
            ("jpg", b"\xff\xd8\xff"),
            ("jpeg", b"\xff\xd8\xff"),
            ("gif", b"GIF87a"),
            ("gif", b"GIF89a"),
            ("webp", b"RIFF1234WEBP"),
            ("pdf", b"%PDF-1.7"),
            ("xlsx", b"PK\x03\x04"),
        ] {
            let extension = Extension::parse(extension).unwrap();
            assert!(sniff(extension, good));
            assert!(!sniff(extension, b"invalid"));
            assert!(!sniff(extension, &good[..2]));
        }
        let mut boundary = vec![b'a'; HEAD_BYTES - 1];
        boundary.push(0xe4);
        for extension in ["txt", "md", "csv", "json"] {
            let extension = Extension::parse(extension).unwrap();
            assert!(sniff(extension, "中文".as_bytes()));
            assert!(sniff(extension, b""));
            assert!(sniff(extension, &boundary));
            assert!(!sniff(extension, b"\xff"));
            assert!(!sniff(extension, b"\xe4"));
            let mut invalid = boundary.clone();
            invalid[0] = 0xff;
            assert!(!sniff(extension, &invalid));
        }
        assert_eq!(text_prefix(&boundary).unwrap().len(), HEAD_BYTES - 1);
        for unknown in ["", "exe", "PNG", "text"] {
            assert!(Extension::parse(unknown).is_none());
        }
    }
}
