use super::*;
use crate::{error::JOB_CANCELLED, job::CancellationToken};

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Document {
    dataset: String,
    version: u32,
    exported_at: String,
    rows: Vec<ExchangeRow>,
}

pub(super) fn read(
    exchange: &Exchange<'_>,
    bytes: &[u8],
) -> Result<Vec<(u32, ExchangeRow)>, AppError> {
    let document: Document = serde_json::from_slice(bytes).map_err(|_| invalid("file"))?;
    if document.dataset != exchange.dataset.code {
        return Err(AppError::new(DATASET_MISMATCH));
    }
    if document.version != 1 || document.exported_at.parse::<jiff::Timestamp>().is_err() {
        return Err(invalid("file"));
    }
    if document.rows.len() > exchange.dataset.limits.import_rows {
        return Err(too_many(exchange.dataset.limits.import_rows));
    }
    let mut rows = Vec::new();
    for (index, row) in document.rows.into_iter().enumerate() {
        for key in row.keys() {
            if !exchange
                .dataset
                .columns
                .iter()
                .any(|column| column.key == key)
            {
                return Err(header_invalid(key));
            }
        }
        exchange.required_headers(&row.keys().map(String::as_str).collect())?;
        rows.push((index as u32 + 1, row));
    }
    Ok(rows)
}

pub(super) fn write(
    exchange: &Exchange<'_>,
    rows: &[ExchangeRow],
    cancellation: &CancellationToken,
) -> Result<Vec<u8>, AppError> {
    let mut values = Vec::with_capacity(rows.len());
    for row in rows {
        if cancellation.is_cancelled() {
            return Err(AppError::new(JOB_CANCELLED));
        }
        values.push(
            exchange
                .dataset
                .columns
                .iter()
                .map(|column| {
                    (
                        column.key.into(),
                        row.get(column.key).cloned().unwrap_or(Value::Null),
                    )
                })
                .collect(),
        );
    }
    serde_json::to_vec_pretty(&Document {
        dataset: exchange.dataset.code.into(),
        version: 1,
        exported_at: jiff::Timestamp::now().to_string(),
        rows: values,
    })
    .map_err(|_| invalid("file"))
}
