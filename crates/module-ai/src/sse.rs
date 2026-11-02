//! WHATWG SSE 的字节/行边界；无重连、JSON 或网络职责。
use tenon_framework::error::AppError;

use crate::{LIMIT, MAX_SSE_EVENT_BYTES, MAX_SSE_LINE_BYTES};

pub(crate) struct Event {
    pub event: String,
    pub data: String,
}

pub(crate) struct Decoder {
    line: Vec<u8>,
    first_line: bool,
    skip_lf: bool,
    event_bytes: usize,
    data: String,
    event: String,
    has_data: bool,
}

impl Default for Decoder {
    fn default() -> Self {
        Self {
            line: Vec::new(),
            first_line: true,
            skip_lf: false,
            event_bytes: 0,
            data: String::new(),
            event: String::new(),
            has_data: false,
        }
    }
}

impl Decoder {
    // 调用方逐事件消费，既不收集整个响应，也不创建无界事件队列。
    pub fn next(&mut self, input: &mut &[u8]) -> Result<Option<Event>, AppError> {
        while let Some((&byte, tail)) = input.split_first() {
            *input = tail;
            if self.skip_lf {
                self.skip_lf = false;
                if byte == b'\n' {
                    // CRLF 是同一个换行，空行已在 CR 时派发。
                    if self.event_bytes != 0 {
                        self.count_byte()?;
                    }
                    continue;
                }
            }
            self.count_byte()?;
            if matches!(byte, b'\r' | b'\n') {
                self.skip_lf = byte == b'\r';
                if let Some(event) = self.end_line() {
                    return Ok(Some(event));
                }
            } else {
                if self.line.len() == MAX_SSE_LINE_BYTES {
                    return Err(AppError::new(LIMIT));
                }
                self.line.push(byte);
            }
        }
        // EOF 没有额外 flush；没有空行的事件不得补发。
        Ok(None)
    }

    fn count_byte(&mut self) -> Result<(), AppError> {
        self.event_bytes += 1;
        if self.event_bytes > MAX_SSE_EVENT_BYTES {
            return Err(AppError::new(LIMIT));
        }
        Ok(())
    }

    fn end_line(&mut self) -> Option<Event> {
        let raw = std::mem::take(&mut self.line);
        let raw = if std::mem::replace(&mut self.first_line, false) {
            raw.strip_prefix(&[0xef, 0xbb, 0xbf]).unwrap_or(&raw)
        } else {
            &raw
        };
        // 保留完整物理行后解码，因此任意分块不会拆坏 UTF-8 码点。
        let line = String::from_utf8_lossy(raw);
        if line.is_empty() {
            self.event_bytes = 0;
            let event = std::mem::take(&mut self.event);
            if !std::mem::replace(&mut self.has_data, false) {
                return None;
            }
            self.data.pop(); // 每条 data 都恰好追加了一个 LF。
            return Some(Event {
                event: if event.is_empty() {
                    "message".into()
                } else {
                    event
                },
                data: std::mem::take(&mut self.data),
            });
        }
        let (field, value) = line.split_once(':').unwrap_or((&line, ""));
        let value = value.strip_prefix(' ').unwrap_or(value);
        match field {
            "data" => {
                self.has_data = true;
                self.data.push_str(value);
                self.data.push('\n');
            }
            "event" => self.event = value.into(),
            // 不消费 last-event-id/retry；也不将未知字段或注释转成内容。
            _ => {}
        }
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn decode(chunks: &[&[u8]]) -> Result<Vec<(String, String)>, AppError> {
        let mut decoder = Decoder::default();
        let mut events = Vec::new();
        for mut chunk in chunks.iter().copied() {
            while let Some(event) = decoder.next(&mut chunk)? {
                events.push((event.event, event.data));
            }
        }
        Ok(events)
    }

    #[test]
    fn sse_chunk_boundaries_and_utf8() {
        let bytes = "\u{feff}data: 中文😀\r\ndata: 第二行\r\n\r\ndata: 尾\r\r".as_bytes();
        let expected = vec![
            ("message".into(), "中文😀\n第二行".into()),
            ("message".into(), "尾".into()),
        ];
        for cut in 0..=bytes.len() {
            assert_eq!(decode(&[&bytes[..cut], &bytes[cut..]]).unwrap(), expected);
        }
        assert_eq!(
            decode(&bytes.chunks(1).collect::<Vec<_>>()).unwrap(),
            expected
        );
        assert_eq!(decode(&[b"data: \xff\n\n"]).unwrap()[0].1, "\u{fffd}");
        assert_eq!(
            decode(&["data: \u{feff}\n\n".as_bytes()]).unwrap()[0].1,
            "\u{feff}"
        );
    }

    #[test]
    fn sse_fields_comments_and_eof() {
        let input = b": hello\nid: a\0b\nretry: 12\nretry: 1x\nunknown: x\n\ndata:  spaced \ndata\ndata:\nevent: custom\n\ndata: discarded\n";
        assert_eq!(
            decode(&[input]).unwrap(),
            [("custom".into(), " spaced \n\n".into())]
        );
        assert_eq!(
            decode(&[b"data:\n\n"]).unwrap(),
            [("message".into(), "".into())]
        );
        assert!(decode(&[b"data: no blank"]).unwrap().is_empty());
    }

    #[test]
    fn sse_limits_count_ignored_bytes() {
        for bytes in [
            vec![b'x'; MAX_SSE_LINE_BYTES + 1],
            b": ignored\n".repeat(MAX_SSE_EVENT_BYTES / 10 + 1),
            b"data: x\n".repeat(MAX_SSE_EVENT_BYTES / 8 + 1),
        ] {
            assert_eq!(decode(&[&bytes]).err().unwrap().code(), LIMIT);
        }
        let bytes = [
            b"data: ".as_slice(),
            &vec![b'x'; MAX_SSE_EVENT_BYTES - 8],
            b"\n\n",
        ]
        .concat();
        assert_eq!(bytes.len(), MAX_SSE_EVENT_BYTES);
        assert_eq!(decode(&[&bytes]).unwrap().len(), 1);
        let mut decoder = Decoder::default();
        for _ in 0..100 {
            assert!(
                decoder
                    .next(&mut b": heartbeat\n\n".as_slice())
                    .unwrap()
                    .is_none()
            );
        }
    }
}
