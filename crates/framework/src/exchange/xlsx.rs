use super::*;
use crate::{error::JOB_CANCELLED, job::CancellationToken};
use calamine::{Data, DataRef, Reader, Xlsx};
use rust_xlsxwriter::{DataValidation, ExcelDateTime, Format, Workbook};
use std::io::{self, Cursor, Read};

// 普通工作簿通常只有十几个 ZIP 条目，256 为工作表及配套资源留出余量。
pub(super) const XLSX_MAX_ENTRIES: usize = 256;
// 常规万行导入的工作表或共享字符串为 MiB 量级，单条目保留 64 MiB 余量。
pub(super) const XLSX_MAX_ENTRY_BYTES: u64 = 64 * 1024 * 1024;
// 工作表、共享字符串与配套 XML 合计保留两个最大条目的 128 MiB 预算。
pub(super) const XLSX_MAX_TOTAL_BYTES: u64 = 128 * 1024 * 1024;
// 等于接受的最大单个 XML 条目（XLSX_MAX_ENTRY_BYTES）；常规万行文本为 MiB 量级，
// 预算内仍允许大量重复引用长共享字符串。
pub(super) const XLSX_MAX_CELL_BYTES: u64 = 64 * 1024 * 1024;

pub(super) struct XlsxBudget {
    pub(super) entries: usize,
    pub(super) entry_bytes: u64,
    pub(super) total_bytes: u64,
    pub(super) cell_bytes: u64,
}

impl Default for XlsxBudget {
    fn default() -> Self {
        Self {
            entries: XLSX_MAX_ENTRIES,
            entry_bytes: XLSX_MAX_ENTRY_BYTES,
            total_bytes: XLSX_MAX_TOTAL_BYTES,
            cell_bytes: XLSX_MAX_CELL_BYTES,
        }
    }
}

pub(super) fn preflight(bytes: &[u8], budget: &XlsxBudget) -> Result<(), AppError> {
    // Calamine 会先从字节 0 探测 OLE/CFB，其循环不受预算约束；合法 OOXML 包以 ZIP 本地文件头开始。
    if !bytes.starts_with(b"PK\x03\x04") {
        return Err(invalid("file"));
    }
    let mut archive = zip::ZipArchive::new(Cursor::new(bytes)).map_err(|_| invalid("file"))?;
    // ZIP 8.6 会按原始名称合并记录；数原始中央目录，避免漏掉重名条目。
    let start = usize::try_from(archive.central_directory_start()).map_err(|_| invalid("file"))?;
    let mut directory = bytes.get(start..).ok_or_else(|| invalid("file"))?;
    let mut entries = 0;
    while directory.starts_with(b"PK\x01\x02") {
        let header = directory.get(..46).ok_or_else(|| invalid("file"))?;
        let length: usize = [28, 30, 32]
            .into_iter()
            .map(|offset| usize::from(u16::from_le_bytes([header[offset], header[offset + 1]])))
            .sum();
        directory = directory
            .get(46 + length..)
            .ok_or_else(|| invalid("file"))?;
        entries += 1;
        if entries > budget.entries {
            return Err(AppError::new(FILE_TOO_LARGE));
        }
    }
    if entries != archive.len() {
        return Err(invalid("file"));
    }

    let mut names = BTreeSet::new();
    let mut total = 0;
    for index in 0..archive.len() {
        let entry = archive.by_index(index).map_err(|_| invalid("file"))?;
        if !names.insert(entry.name().to_owned()) {
            return Err(invalid("file"));
        }
        let declared = entry.size();
        // 单条目和剩余总预算均只多读 1 字节，用实际解压量判定超限。
        let limit = budget.entry_bytes.min(budget.total_bytes - total);
        let actual =
            io::copy(&mut entry.take(limit + 1), &mut io::sink()).map_err(|_| invalid("file"))?;
        total += actual;
        if actual > budget.entry_bytes || total > budget.total_bytes {
            return Err(AppError::new(FILE_TOO_LARGE));
        }
        if actual != declared {
            return Err(invalid("file"));
        }
    }
    Ok(())
}

fn cell(value: &Data) -> Result<Value, AppError> {
    Ok(match value {
        Data::Empty => Value::Null,
        Data::String(value) | Data::DateTimeIso(value) => Value::String(value.clone()),
        Data::Int(value) => Value::String(value.to_string()),
        Data::Float(value) => Value::String(value.to_string()),
        Data::Bool(value) => Value::Bool(*value),
        Data::DateTime(value) if value.is_datetime() => {
            let (year, month, day, hour, minute, second, millis) = value.to_ymd_hms_milli();
            let time = jiff::civil::DateTime::new(
                year as i16,
                month as i8,
                day as i8,
                hour as i8,
                minute as i8,
                second as i8,
                i32::from(millis) * 1_000_000,
            )
            .map_err(|_| invalid("file"))?;
            Value::String(
                time.to_zoned(jiff::tz::TimeZone::system())
                    .map_err(|_| invalid("file"))?
                    .timestamp()
                    .to_string(),
            )
        }
        _ => return Err(invalid("file")),
    })
}

fn blank(value: &Data) -> bool {
    matches!(value, Data::Empty) || matches!(value, Data::String(text) if text.trim().is_empty())
}

pub(super) fn read(
    exchange: &Exchange<'_>,
    bytes: &[u8],
) -> Result<Vec<(u32, ExchangeRow)>, AppError> {
    read_with(exchange, bytes, &XlsxBudget::default())
}

pub(super) fn read_with(
    exchange: &Exchange<'_>,
    bytes: &[u8],
    budget: &XlsxBudget,
) -> Result<Vec<(u32, ExchangeRow)>, AppError> {
    preflight(bytes, budget)?;
    let mut book = Xlsx::new(Cursor::new(bytes)).map_err(|_| invalid("file"))?;
    let name = book
        .sheet_names()
        .first()
        .ok_or_else(|| header_invalid(""))?
        .clone();
    let mut reader = book
        .worksheet_cells_reader(&name)
        .map_err(|_| invalid("file"))?;
    // 逐格限制列数与非空数据行数；只保留原始行号，不按稀疏坐标扩展矩形。
    let mut rows = Vec::new();
    let mut current = (0, Vec::new());
    let mut nonempty = false;
    let mut cell_bytes = 0_u64;
    while let Some(cell) = reader.next_cell().map_err(|_| invalid("file"))? {
        let (row, col) = cell.get_position();
        if row != current.0 {
            if current.0 == 0 || nonempty {
                rows.push(current);
            }
            current = (row, Vec::new());
            nonempty = false;
        }
        let text_bytes = match cell.get_value() {
            DataRef::String(text) | DataRef::DateTimeIso(text) | DataRef::DurationIso(text) => {
                text.len()
            }
            DataRef::SharedString(text) => text.len(),
            _ => 0,
        };
        cell_bytes = cell_bytes.saturating_add(text_bytes as u64);
        if cell_bytes > budget.cell_bytes {
            return Err(AppError::new(FILE_TOO_LARGE));
        }
        let value: Data = cell.get_value().clone().into();
        if col as usize >= exchange.dataset.columns.len() {
            if row > 0 && blank(&value) {
                continue;
            }
            return Err(header_invalid(&(col + 1).to_string()));
        }
        if row > 0 && !nonempty && !blank(&value) {
            if rows.len() - 1 == exchange.dataset.limits.import_rows {
                return Err(too_many(exchange.dataset.limits.import_rows));
            }
            nonempty = true;
        }
        current.1.resize(col as usize + 1, Data::Empty);
        current.1[col as usize] = value;
    }
    if current.0 == 0 || nonempty {
        rows.push(current);
    }
    let mut rows = rows.into_iter();
    let headers = rows
        .next()
        .ok_or_else(|| header_invalid(""))?
        .1
        .iter()
        .map(|value| match value {
            Data::String(text) => Ok(text.clone()),
            _ => Err(header_invalid("")),
        })
        .collect::<Result<Vec<_>, _>>()?;
    let columns = exchange.match_headers(&headers)?;
    let mut result = Vec::new();
    for (index, cells) in rows {
        let row = columns
            .iter()
            .zip(cells.iter())
            .map(|(column, value)| cell(value).map(|value| (column.key.into(), value)))
            .collect::<Result<_, _>>()?;
        result.push((index + 1, row));
    }
    Ok(result)
}

pub(super) fn write(
    exchange: &Exchange<'_>,
    rows: &[ExchangeRow],
    cancellation: &CancellationToken,
) -> Result<Vec<u8>, AppError> {
    let mut book = Workbook::new();
    let sheet = book.add_worksheet();
    let date_format = Format::new().set_num_format("yyyy-mm-dd hh:mm:ss");
    let heading = Format::new().set_bold();
    for (index, header) in exchange.headers()?.iter().enumerate() {
        sheet
            .write_string_with_format(0, index as u16, header, &heading)
            .map_err(|_| invalid("file"))?;
        sheet
            .set_column_width(index as u16, 24)
            .map_err(|_| invalid("file"))?;
    }
    for (index, column) in exchange.dataset.columns.iter().enumerate() {
        if let Some(code) = column.dict {
            let labels = exchange.dictionaries.labels(code, exchange.language)?;
            if !labels.is_empty()
                && labels.iter().all(|label| !label.contains(','))
                && labels.join(",").chars().count() <= 255
            {
                let validation = DataValidation::new()
                    .allow_list_strings(&labels)
                    .map_err(|_| invalid("file"))?;
                sheet
                    .add_data_validation(
                        1,
                        index as u16,
                        exchange.dataset.limits.import_rows.max(rows.len()) as u32,
                        index as u16,
                        &validation,
                    )
                    .map_err(|_| invalid("file"))?;
            }
        }
    }
    for (index, values) in rows.iter().enumerate() {
        if cancellation.is_cancelled() {
            return Err(AppError::new(JOB_CANCELLED));
        }
        for (col, column) in exchange.dataset.columns.iter().enumerate() {
            let value = values.get(column.key).unwrap_or(&Value::Null);
            if value.is_null() {
                continue;
            }
            let (row, col) = (index as u32 + 1, col as u16);
            let result = match (column.kind, value) {
                (ColumnKind::Boolean, Value::Bool(value)) => sheet.write_boolean(row, col, *value),
                (ColumnKind::Integer, Value::Number(value)) => {
                    sheet.write_number(row, col, value.as_f64().ok_or_else(|| invalid(column.key))?)
                }
                (ColumnKind::Timestamp, Value::String(value)) => {
                    let date = value
                        .parse::<jiff::Timestamp>()
                        .map_err(|_| invalid(column.key))?
                        .to_zoned(jiff::tz::TimeZone::system());
                    let date = ExcelDateTime::from_ymd(
                        date.year() as u16,
                        date.month() as u8,
                        date.day() as u8,
                    )
                    .and_then(|day| {
                        day.and_hms(
                            date.hour() as u16,
                            date.minute() as u8,
                            f64::from(date.second()),
                        )
                    })
                    .map_err(|_| invalid(column.key))?;
                    sheet.write_datetime_with_format(row, col, &date, &date_format)
                }
                _ => sheet.write_string(row, col, exchange.human_text(column, value)?),
            };
            result.map_err(|_| invalid(column.key))?;
        }
    }
    book.save_to_buffer().map_err(|_| invalid("file"))
}
