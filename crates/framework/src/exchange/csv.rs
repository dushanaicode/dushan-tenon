use super::*;
use crate::{error::JOB_CANCELLED, job::CancellationToken};

fn formula(text: &str) -> bool {
    text.starts_with(['=', '+', '-', '@', '\t', '\r'])
}

pub(super) fn read(
    exchange: &Exchange<'_>,
    bytes: &[u8],
) -> Result<Vec<(u32, ExchangeRow)>, AppError> {
    let text = std::str::from_utf8(bytes).map_err(|_| AppError::new(ENCODING_INVALID))?;
    let mut reader = ::csv::ReaderBuilder::new()
        .has_headers(false)
        .flexible(true)
        .from_reader(text.trim_start_matches('\u{feff}').as_bytes());
    let mut records = reader.records();
    let headers = records
        .next()
        .ok_or_else(|| header_invalid(""))?
        .map_err(|_| header_invalid(""))?;
    let columns = exchange.match_headers(&headers.iter().map(str::to_owned).collect::<Vec<_>>())?;
    let mut rows = Vec::new();
    for (index, record) in records.enumerate() {
        let record = record.map_err(|_| invalid("file"))?;
        if record.iter().all(|text| text.trim().is_empty()) {
            continue;
        }
        if record.len() != columns.len() {
            return Err(invalid("file"));
        }
        if rows.len() == exchange.dataset.limits.import_rows {
            return Err(too_many(exchange.dataset.limits.import_rows));
        }
        let number = index as u32 + 2;
        let values = columns
            .iter()
            .zip(record.iter())
            .map(|(column, text)| {
                let text = text
                    .strip_prefix('\'')
                    .filter(|text| formula(text))
                    .unwrap_or(text);
                (
                    column.key.to_owned(),
                    if text.is_empty() {
                        Value::Null
                    } else {
                        Value::String(text.into())
                    },
                )
            })
            .collect();
        rows.push((number, values));
    }
    Ok(rows)
}

pub(super) fn write(
    exchange: &Exchange<'_>,
    rows: &[ExchangeRow],
    cancellation: &CancellationToken,
) -> Result<Vec<u8>, AppError> {
    let mut writer = ::csv::Writer::from_writer(vec![0xef, 0xbb, 0xbf]);
    let safe = |text: String| {
        if formula(&text) {
            format!("'{text}")
        } else {
            text
        }
    };
    writer
        .write_record(exchange.headers()?.into_iter().map(safe))
        .map_err(|_| invalid("file"))?;
    for row in rows {
        if cancellation.is_cancelled() {
            return Err(AppError::new(JOB_CANCELLED));
        }
        let cells = exchange
            .dataset
            .columns
            .iter()
            .map(|column| {
                exchange
                    .human_text(column, row.get(column.key).unwrap_or(&Value::Null))
                    .map(safe)
            })
            .collect::<Result<Vec<_>, _>>()?;
        writer.write_record(cells).map_err(|_| invalid("file"))?;
    }
    writer.into_inner().map_err(|_| invalid("file"))
}
