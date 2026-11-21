use super::*;
use crate::job::CancellationToken;
use serde_json::json;

struct Text;
impl Translator for Text {
    fn text(&self, key: &str, params: &Map<String, Value>) -> Result<String, AppError> {
        self.text_in(Language::ZhCn, key, params)
    }
    fn text_in(
        &self,
        language: Language,
        key: &str,
        _: &Map<String, Value>,
    ) -> Result<String, AppError> {
        let names = [
            ("name", "姓名", "Name"),
            ("number", "整数", "Number"),
            ("flag", "布尔", "Flag"),
            ("time", "时间", "Time"),
            ("list", "列表", "List"),
            ("status", "状态", "Status"),
            ("empty", "空值", "Empty"),
            ("ignored", "只读", "Ignored"),
        ];
        let (_, zh, en) = names.iter().find(|(name, _, _)| *name == key).unwrap();
        Ok(if language == Language::ZhCn { *zh } else { *en }.into())
    }
}
struct Dict;
impl DictResolver for Dict {
    fn label(&self, _: &str, value: &str, language: Language) -> Result<String, AppError> {
        assert_eq!(value, "active");
        Ok(if language == Language::ZhCn {
            "启用"
        } else {
            "Active"
        }
        .into())
    }
    fn value(&self, _: &str, value: &str) -> Result<Option<String>, AppError> {
        Ok(["active", "启用", "Active"]
            .contains(&value)
            .then(|| "active".into()))
    }
    fn labels(&self, _: &str, language: Language) -> Result<Vec<String>, AppError> {
        Ok(vec![self.label("", "active", language)?])
    }
}
const COLUMNS: &[ExchangeColumn] = &[
    ExchangeColumn {
        key: "name",
        label_key: "name",
        kind: ColumnKind::Text { max_chars: 4096 },
        import: ImportColumn::Required,
        dict: None,
    },
    ExchangeColumn {
        key: "number",
        label_key: "number",
        kind: ColumnKind::Integer,
        import: ImportColumn::Optional,
        dict: None,
    },
    ExchangeColumn {
        key: "flag",
        label_key: "flag",
        kind: ColumnKind::Boolean,
        import: ImportColumn::Optional,
        dict: None,
    },
    ExchangeColumn {
        key: "time",
        label_key: "time",
        kind: ColumnKind::Timestamp,
        import: ImportColumn::Optional,
        dict: None,
    },
    ExchangeColumn {
        key: "list",
        label_key: "list",
        kind: ColumnKind::List { max_items: 3 },
        import: ImportColumn::Optional,
        dict: None,
    },
    ExchangeColumn {
        key: "status",
        label_key: "status",
        kind: ColumnKind::Text { max_chars: 4096 },
        import: ImportColumn::Optional,
        dict: Some("test.status"),
    },
    ExchangeColumn {
        key: "empty",
        label_key: "empty",
        kind: ColumnKind::Text { max_chars: 4096 },
        import: ImportColumn::Optional,
        dict: None,
    },
    ExchangeColumn {
        key: "ignored",
        label_key: "ignored",
        kind: ColumnKind::Text { max_chars: 4096 },
        import: ImportColumn::Ignored,
        dict: None,
    },
];
fn spec() -> ExchangeDataset {
    ExchangeDataset {
        code: "test.rows",
        columns: COLUMNS,
        modes: &[ImportMode::Error],
        limits: ExchangeLimits::default(),
    }
}
fn exchange(spec: &ExchangeDataset, format: ExchangeFormat) -> Exchange<'_> {
    Exchange {
        dataset: spec,
        format,
        language: Language::ZhCn,
        translator: &Text,
        dictionaries: &Dict,
    }
}
fn row() -> ExchangeRow {
    serde_json::from_value(json!({"name":"中文", "number":-42, "flag":true, "time":"2026-10-17T10:20:30Z", "list":["甲","乙"], "status":"active", "empty":null, "ignored":"read-only"})).unwrap()
}

fn xlsx_fixture(bytes: &[u8], replacement: Option<&str>) -> Vec<u8> {
    let root = tempfile::tempdir().unwrap();
    let file = root.path().join("fixture.xlsx");
    std::fs::write(&file, bytes).unwrap();
    let mut command = std::process::Command::new("node");
    command
        .arg(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/src/exchange/xlsx_fixture.mjs"
        ))
        .arg(file);
    if let Some(xml) = replacement {
        let path = root.path().join("sheet.xml");
        std::fs::write(&path, xml).unwrap();
        command.arg(path);
    }
    let output = command.output().unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    output.stdout
}

fn deflated_zip(entries: &[(&str, &[u8])]) -> Vec<u8> {
    use std::io::{Cursor, Write};
    let mut writer = zip::ZipWriter::new(Cursor::new(Vec::new()));
    let options = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);
    for (name, bytes) in entries {
        writer.start_file(*name, options).unwrap();
        writer.write_all(bytes).unwrap();
    }
    writer.finish().unwrap().into_inner()
}

fn xlsx_shared_string_fixture(
    view: &Exchange<'_>,
    text: &str,
    column: &str,
    count: u32,
    unique_count: u64,
) -> Vec<u8> {
    use std::io::{Cursor, Read};

    let base = view.write(&[], &CancellationToken::new()).unwrap();
    let cells: String = (2..count + 2)
        .map(|row| format!(r#"<row r="{row}"><c r="{column}{row}" t="s"><v>0</v></c></row>"#))
        .collect();
    let sheet = format!(
        r#"<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>name</t></is></c></row>{cells}</sheetData></worksheet>"#
    );
    let shared = format!(
        r#"<?xml version="1.0"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="{count}" uniqueCount="{unique_count}"><si><t xml:space="preserve">{text}</t></si></sst>"#
    );
    let mut archive = zip::ZipArchive::new(Cursor::new(base)).unwrap();
    let mut entries = Vec::new();
    for index in 0..archive.len() {
        let mut entry = archive.by_index(index).unwrap();
        let mut data = Vec::new();
        entry.read_to_end(&mut data).unwrap();
        let name = entry.name().unwrap().into_owned();
        match name.as_str() {
            "xl/worksheets/sheet1.xml" => data = sheet.as_bytes().to_vec(),
            "xl/sharedStrings.xml" => data = shared.as_bytes().to_vec(),
            _ => {}
        }
        entries.push((name, data));
    }
    let entries: Vec<_> = entries
        .iter()
        .map(|(name, data)| (name.as_str(), data.as_slice()))
        .collect();
    deflated_zip(&entries)
}

#[test]
fn xlsx_shared_strings_ignore_declared_unique_count() {
    let spec = spec();
    let view = exchange(&spec, ExchangeFormat::Xlsx);
    let budget = xlsx::XlsxBudget::default();
    for unique_count in [1, 1_099_511_627_776] {
        let bytes = xlsx_shared_string_fixture(&view, "共享字符串", "A", 1, unique_count);
        let rows = xlsx::read_with(&view, &bytes, &budget).unwrap();
        assert_eq!(
            rows,
            vec![(2, BTreeMap::from([("name".into(), json!("共享字符串"))]))]
        );
    }
}

#[test]
fn xlsx_cell_text_budget_rejects_shared_string_amplification() {
    let spec = spec();
    let view = exchange(&spec, ExchangeFormat::Xlsx);
    let text = "共".repeat(512);
    let bytes = xlsx_shared_string_fixture(&view, &text, "A", 64, 1);
    let budget = xlsx::XlsxBudget {
        cell_bytes: 64 * 1024,
        ..Default::default()
    };
    let mut archive = zip::ZipArchive::new(std::io::Cursor::new(&bytes)).unwrap();
    let xml_bytes: u64 = (0..archive.len())
        .map(|index| archive.by_index(index).unwrap().size())
        .sum();
    assert!(xml_bytes < budget.cell_bytes / 2);
    xlsx::preflight(&bytes, &budget).unwrap();
    let error = xlsx::read_with(&view, &bytes, &budget).unwrap_err();
    assert_eq!(error.code(), FILE_TOO_LARGE);
    assert!(error.params.is_empty());
}

#[test]
fn xlsx_cell_text_budget_accepts_exact_bytes_and_rejects_one_less() {
    let spec = spec();
    let view = exchange(&spec, ExchangeFormat::Xlsx);
    let text = "共".repeat(512);
    let count = 64;
    let bytes = xlsx_shared_string_fixture(&view, &text, "A", count, 1);
    let mut budget = xlsx::XlsxBudget {
        cell_bytes: ("name".len() + text.len() * count as usize) as u64,
        ..Default::default()
    };
    let rows = xlsx::read_with(&view, &bytes, &budget).unwrap();
    assert_eq!(rows.len(), count as usize);
    for (index, (row, values)) in rows.iter().enumerate() {
        assert_eq!(*row, index as u32 + 2);
        assert_eq!(values["name"], text);
    }
    budget.cell_bytes -= 1;
    let error = xlsx::read_with(&view, &bytes, &budget).unwrap_err();
    assert_eq!(error.code(), FILE_TOO_LARGE);
    assert!(error.params.is_empty());
}

#[test]
fn xlsx_cell_text_budget_counts_blank_shared_strings_beyond_columns() {
    let spec = spec();
    let view = exchange(&spec, ExchangeFormat::Xlsx);
    let text = "\u{2003}".repeat(32);
    let count = 4;
    let bytes = xlsx_shared_string_fixture(&view, &text, "I", count, 1);
    let mut budget = xlsx::XlsxBudget {
        cell_bytes: ("name".len() + text.len() * count as usize) as u64,
        ..Default::default()
    };
    assert!(xlsx::read_with(&view, &bytes, &budget).unwrap().is_empty());
    budget.cell_bytes -= 1;
    let error = xlsx::read_with(&view, &bytes, &budget).unwrap_err();
    assert_eq!(error.code(), FILE_TOO_LARGE);
    assert!(error.params.is_empty());
}

fn zip_entry_headers(bytes: &[u8], index: usize) -> (usize, usize) {
    let mut archive = zip::ZipArchive::new(std::io::Cursor::new(bytes)).unwrap();
    let entry = archive.by_index(index).unwrap();
    (
        entry.header_start() as usize,
        entry.central_header_start() as usize,
    )
}

fn zip_declared_size(bytes: &mut [u8], size: u32) {
    let (local, central) = zip_entry_headers(bytes, 0);
    bytes[local + 22..local + 26].copy_from_slice(&size.to_le_bytes());
    bytes[central + 24..central + 28].copy_from_slice(&size.to_le_bytes());
}

#[test]
fn xlsx_preflight_rejects_ole_prefix_before_calamine() {
    let spec = spec();
    let view = exchange(&spec, ExchangeFormat::Xlsx);
    let bytes = xlsx_shared_string_fixture(&view, "普通数据", "A", 1, 1);
    let budget = xlsx::XlsxBudget::default();
    xlsx::preflight(&bytes, &budget).unwrap();
    let rows = xlsx::read_with(&view, &bytes, &budget).unwrap();
    assert_eq!(
        rows,
        vec![(2, BTreeMap::from([("name".into(), json!("普通数据"))]))]
    );

    let mut prefixed = vec![0; 512];
    prefixed[..8].copy_from_slice(b"\xD0\xCF\x11\xE0\xA1\xB1\x1A\xE1");
    prefixed.extend_from_slice(&bytes);
    let error = xlsx::preflight(&prefixed, &budget).unwrap_err();
    assert_eq!(error.code(), INPUT_INVALID);
    assert_eq!(error.params["path"], "file");
}

#[test]
fn xlsx_preflight_accepts_exported_workbook() {
    let spec = spec();
    let view = exchange(&spec, ExchangeFormat::Xlsx);
    let bytes = view
        .write(
            &[BTreeMap::from([("name".into(), json!("普通数据"))])],
            &CancellationToken::new(),
        )
        .unwrap();
    xlsx::preflight(&bytes, &xlsx::XlsxBudget::default()).unwrap();
    let rows = view.read(&bytes).unwrap();
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].1["name"], "普通数据");
}

#[test]
fn xlsx_preflight_entry_limit_precedes_calamine() {
    let names: Vec<_> = (0..257).map(|index| format!("{index}.xml")).collect();
    let entries: Vec<_> = names.iter().map(|name| (name.as_str(), &b""[..])).collect();
    let bytes = deflated_zip(&entries);
    let spec = spec();
    let view = exchange(&spec, ExchangeFormat::Xlsx);
    assert!(bytes.len() < spec.limits.file_bytes);
    // 没有工作簿结构：若先进入 Calamine，只会得到 input_invalid。
    let error = view.read(&bytes).unwrap_err();
    assert_eq!(error.code(), FILE_TOO_LARGE);
    assert!(error.params.is_empty());
}

#[test]
fn xlsx_preflight_bounds_actual_inflation_even_when_declared_size_is_small() {
    let budget = xlsx::XlsxBudget {
        entries: 2,
        entry_bytes: 1024,
        total_bytes: 2048,
        ..Default::default()
    };
    let payload = vec![b'A'; 64 * 1024];
    let original = deflated_zip(&[("xl/sharedStrings.xml", &payload)]);
    assert!(original.len() < budget.entry_bytes as usize);
    for lie in [false, true] {
        let mut bytes = original.clone();
        if lie {
            zip_declared_size(&mut bytes, 1);
        }
        // 直接预检无工作簿结构的 ZIP，不经 Calamine 分配字符串。
        // 声明偏小时，ZIP 库读到超过声明值就报错，按无效文件拒绝；两种情况都不会解压出全部数据。
        let error = xlsx::preflight(&bytes, &budget).unwrap_err();
        if lie {
            assert_eq!(error.code(), INPUT_INVALID);
            assert_eq!(error.params["path"], "file");
        } else {
            assert_eq!(error.code(), FILE_TOO_LARGE);
            assert!(error.params.is_empty());
        }
    }
}

#[test]
fn xlsx_preflight_enforces_injected_entry_count() {
    let budget = xlsx::XlsxBudget {
        entries: 1,
        entry_bytes: 32,
        total_bytes: 64,
        ..Default::default()
    };
    let bytes = deflated_zip(&[("a.xml", b"a"), ("b.xml", b"b")]);
    let error = xlsx::preflight(&bytes, &budget).unwrap_err();
    assert_eq!(error.code(), FILE_TOO_LARGE);
    assert!(error.params.is_empty());
}

#[test]
fn xlsx_preflight_enforces_total_when_each_entry_fits() {
    let budget = xlsx::XlsxBudget {
        entries: 2,
        entry_bytes: 64,
        total_bytes: 63,
        ..Default::default()
    };
    let payload = [b'A'; 32];
    let entries = [("a.xml", &payload[..]), ("b.xml", &payload[..])];
    for entry in entries {
        xlsx::preflight(&deflated_zip(&[entry]), &budget).unwrap();
    }
    let error = xlsx::preflight(&deflated_zip(&entries), &budget).unwrap_err();
    assert_eq!(error.code(), FILE_TOO_LARGE);
    assert!(error.params.is_empty());
}

#[test]
fn xlsx_preflight_accepts_exact_budget_boundaries() {
    let budget = xlsx::XlsxBudget {
        entries: 2,
        entry_bytes: 32,
        total_bytes: 64,
        ..Default::default()
    };
    let payload = [b'A'; 32];
    let bytes = deflated_zip(&[("a.xml", &payload), ("b.xml", &payload)]);
    xlsx::preflight(&bytes, &budget).unwrap();
}

#[test]
fn xlsx_preflight_rejects_duplicate_names_hidden_by_zip_archive() {
    let mut bytes = deflated_zip(&[("a.xml", b"a"), ("b.xml", b"b")]);
    let (local, central) = zip_entry_headers(&bytes, 1);
    // ZipWriter 拒绝重名；生成后同时改本地头和中央目录的等长名称。
    bytes[local + 30..local + 35].copy_from_slice(b"a.xml");
    bytes[central + 46..central + 51].copy_from_slice(b"a.xml");
    let archive = zip::ZipArchive::new(std::io::Cursor::new(&bytes)).unwrap();
    assert_eq!(archive.len(), 1); // ZIP 库合并了两个同名记录。
    let error = xlsx::preflight(&bytes, &xlsx::XlsxBudget::default()).unwrap_err();
    assert_eq!(error.code(), INPUT_INVALID);
    assert_eq!(error.params["path"], "file");
}

#[test]
fn xlsx_preflight_rejects_declared_sizes_that_disagree_with_actual_bytes() {
    let payload = [b'A'; 2048];
    let budget = xlsx::XlsxBudget {
        entries: 1,
        entry_bytes: 4096,
        total_bytes: 4096,
        ..Default::default()
    };
    for declared in [1, 2049] {
        let mut bytes = deflated_zip(&[("a.xml", &payload)]);
        zip_declared_size(&mut bytes, declared);
        let mut archive = zip::ZipArchive::new(std::io::Cursor::new(&bytes)).unwrap();
        // 不依赖 ZIP 库读取时是否核对尺寸；声明与实际不一致由框架预检拒绝。
        assert_eq!(archive.by_index(0).unwrap().size(), u64::from(declared));
        let error = xlsx::preflight(&bytes, &budget).unwrap_err();
        assert_eq!(error.code(), INPUT_INVALID);
        assert_eq!(error.params["path"], "file");
    }
}

#[test]
fn xlsx_preflight_rejects_invalid_zip() {
    let error = xlsx::preflight(b"not a zip", &xlsx::XlsxBudget::default()).unwrap_err();
    assert_eq!(error.code(), INPUT_INVALID);
    assert_eq!(error.params["path"], "file");
}

#[test]
fn xlsx_limits_stop_before_later_cells_and_ignore_unbounded_dimensions() {
    let mut spec = spec();
    spec.limits.import_rows = 1;
    let view = exchange(&spec, ExchangeFormat::Xlsx);
    let base = view.write(&[], &CancellationToken::new()).unwrap();
    for (cells, code, parameter) in [
        (
            r#"<row r="1"><c r="A1" t="inlineStr"><is><t>name</t></is></c></row><row r="2"><c r="A2"><v>1</v></c></row><row r="3"><c r="A3"><v>2</v></c></row><row r="4"><c r="A4" t="e"><v>INVALID_ERROR</v></c></row>"#,
            TOO_MANY_ROWS,
            ("max", "1"),
        ),
        (
            r#"<row r="1"><c r="A1" t="inlineStr"><is><t>name</t></is></c><c r="I1"><v>1</v></c><c r="J1" t="e"><v>INVALID_ERROR</v></c></row>"#,
            HEADER_INVALID,
            ("column", "9"),
        ),
    ] {
        let xml = format!(
            r#"<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:XFD1048576"/><sheetData>{cells}</sheetData></worksheet>"#
        );
        let bytes = xlsx_fixture(&base, Some(&xml));
        let error = view.read(&bytes).unwrap_err();
        assert_eq!(error.code(), code);
        assert_eq!(error.params[parameter.0], parameter.1);
        // 全表读取会读到后面的损坏单元格；有界读取必须先在越界位置终止。
        use calamine::Reader;
        let mut full = calamine::Xlsx::new(std::io::Cursor::new(&bytes)).unwrap();
        assert!(full.worksheet_range_at(0).unwrap().is_err());
    }
}

#[test]
fn xlsx_omits_dropdown_when_joined_labels_exceed_255_characters() {
    struct LongDict(usize);
    impl DictResolver for LongDict {
        fn label(&self, _: &str, _: &str, _: Language) -> Result<String, AppError> {
            Ok("标签".into())
        }
        fn value(&self, _: &str, _: &str) -> Result<Option<String>, AppError> {
            panic!("unexpected dictionary lookup")
        }
        fn labels(&self, _: &str, _: Language) -> Result<Vec<String>, AppError> {
            Ok(vec!["甲".repeat(127), "乙".repeat(self.0)])
        }
    }
    let spec = spec();
    for (last_length, expected) in [(127, true), (128, false)] {
        let dict = LongDict(last_length);
        let view = Exchange {
            dictionaries: &dict,
            ..exchange(&spec, ExchangeFormat::Xlsx)
        };
        for rows in [vec![], vec![row()]] {
            let bytes = view.write(&rows, &CancellationToken::new()).unwrap();
            let xml = String::from_utf8(xlsx_fixture(&bytes, None)).unwrap();
            assert_eq!(xml.contains("<dataValidation "), expected);
        }
    }
}

#[test]
fn all_formats_round_trip_chinese_types_nulls_and_ignored_columns() {
    let spec = spec();
    for format in [
        ExchangeFormat::Xlsx,
        ExchangeFormat::Csv,
        ExchangeFormat::Json,
    ] {
        for language in [Language::ZhCn, Language::EnUs] {
            let view = Exchange {
                language,
                ..exchange(&spec, format)
            };
            let bytes = view.write(&[row()], &CancellationToken::new()).unwrap();
            let parsed = view.read(&bytes).unwrap();
            assert_eq!(
                parsed[0].0,
                if format == ExchangeFormat::Json { 1 } else { 2 }
            );
            let (actual, errors) = view.normalize(parsed[0].0, parsed[0].1.clone());
            assert!(errors.is_empty(), "{format:?}: {errors:?}");
            let mut expected = row();
            expected.remove("ignored");
            assert_eq!(actual, expected, "{format:?}");
            if format == ExchangeFormat::Csv {
                assert!(bytes.starts_with(&[0xef, 0xbb, 0xbf]));
            }
        }
    }
}

#[test]
fn xlsx_omits_dropdown_for_comma_labels_or_an_empty_dictionary() {
    struct CustomDict(Vec<String>);
    impl DictResolver for CustomDict {
        fn label(&self, _: &str, _: &str, _: Language) -> Result<String, AppError> {
            Ok("类别,子类".into())
        }
        fn value(&self, _: &str, _: &str) -> Result<Option<String>, AppError> {
            panic!("unexpected dictionary lookup")
        }
        fn labels(&self, _: &str, _: Language) -> Result<Vec<String>, AppError> {
            Ok(self.0.clone())
        }
    }
    let spec = spec();
    for labels in [vec!["普通".into(), "类别,子类".into()], vec![]] {
        let dict = CustomDict(labels);
        let view = Exchange {
            dictionaries: &dict,
            ..exchange(&spec, ExchangeFormat::Xlsx)
        };
        for rows in [vec![], vec![row()]] {
            let bytes = view.write(&rows, &CancellationToken::new()).unwrap();
            let xml = String::from_utf8(xlsx_fixture(&bytes, None)).unwrap();
            assert!(!xml.contains("<dataValidation "));
            if !rows.is_empty() {
                assert_eq!(view.read(&bytes).unwrap()[0].1["status"], "类别,子类");
            }
        }
    }
}

#[test]
fn csv_error_rows_count_records_including_multiline_cells() {
    let spec = spec();
    let view = exchange(&spec, ExchangeFormat::Csv);
    let rows = view
        .read(b"name,number\n\"first\nline\",1\nsecond,invalid\n")
        .unwrap();
    assert_eq!(rows[0].1["name"], "first\nline");
    let errors = view.normalize(rows[1].0, rows[1].1.clone()).1;
    assert_eq!(errors.len(), 1);
    assert_eq!(errors[0].row, 3);
    assert_eq!(errors[0].column.as_deref(), Some("number"));
}

#[test]
fn csv_and_xlsx_ignore_blank_rows_without_changing_original_row_numbers_or_limits() {
    let mut spec = spec();
    spec.limits.import_rows = 2;
    let mut book = rust_xlsxwriter::Workbook::new();
    let sheet = book.add_worksheet();
    sheet.write_string(0, 0, "name").unwrap();
    sheet.write_string(0, 1, "number").unwrap();
    sheet.write_string(1, 0, "first").unwrap();
    sheet.write_number(1, 1, 0).unwrap();
    let formatted = rust_xlsxwriter::Format::new().set_bold();
    sheet.write_blank(2, 0, &formatted).unwrap();
    sheet.write_string(3, 0, " \t").unwrap();
    sheet.write_string(3, 1, "　").unwrap();
    sheet.write_string(4, 0, "second").unwrap();
    sheet.write_string(4, 1, "invalid").unwrap();
    sheet.write_blank(5, 0, &formatted).unwrap();
    sheet.write_string(1_048_575, 0, "　").unwrap();
    sheet.write_blank(1_048_575, 16_383, &formatted).unwrap();
    for (format, bytes) in [
        (
            ExchangeFormat::Csv,
            "name,number\nfirst,0\n,,,\n \t,　\nsecond,invalid\n,\n　, \n"
                .as_bytes()
                .to_vec(),
        ),
        (ExchangeFormat::Xlsx, book.save_to_buffer().unwrap()),
    ] {
        let view = exchange(&spec, format);
        let rows = view.read(&bytes).unwrap();
        assert_eq!(rows.len(), 2, "{format:?}");
        assert_eq!(
            rows.iter().map(|(number, _)| *number).collect::<Vec<_>>(),
            [2, 5]
        );
        assert!(view.normalize(rows[0].0, rows[0].1.clone()).1.is_empty());
        let errors = view.normalize(rows[1].0, rows[1].1.clone()).1;
        assert_eq!(errors.len(), 1);
        assert_eq!(errors[0].row, 5);
        assert_eq!(errors[0].column.as_deref(), Some("number"));
    }
    let view = exchange(&spec, ExchangeFormat::Json);
    let document = json!({
        "dataset": "test.rows",
        "version": 1,
        "exportedAt": "2026-10-17T00:00:00Z",
        "rows": [{"name": ""}],
    });
    let rows = view.read(document.to_string().as_bytes()).unwrap();
    assert_eq!(rows.len(), 1);
    assert_eq!(view.normalize(rows[0].0, rows[0].1.clone()).1[0].row, 1);
}

#[test]
fn headers_match_keys_bilingual_trim_case_and_reject_unknown_missing_duplicates() {
    let spec = spec();
    let view = exchange(&spec, ExchangeFormat::Csv);
    for header in ["name", " 姓名 ", " NaMe "] {
        assert_eq!(
            view.read(format!("{header}\n甲\n").as_bytes()).unwrap()[0].1["name"],
            "甲"
        );
    }
    for header in ["unknown", "number", "name,Name", "name,未知"] {
        assert_eq!(
            view.read(format!("{header}\n").as_bytes())
                .unwrap_err()
                .code(),
            HEADER_INVALID
        );
    }
    for value in ["true", "false", "1", "0", "是", "否", "Yes", "No"] {
        let rows = view
            .read(format!("name,flag\n甲,{value}\n").as_bytes())
            .unwrap();
        assert!(view.normalize(2, rows[0].1.clone()).1.is_empty());
    }
    let parsed = view
        .read("name,list,status\n甲,\" a， b、 c \" ,启用\n".as_bytes())
        .unwrap();
    assert_eq!(
        view.normalize(2, parsed[0].1.clone()).0["list"],
        json!(["a", "b", "c"])
    );
}

#[test]
fn csv_bom_formula_and_encoding_contract() {
    let spec = spec();
    let view = exchange(&spec, ExchangeFormat::Csv);
    for text in ["=1+1", "+cmd", "-123", "@SUM(A1)", "\ttext", "\rtext"] {
        let row = BTreeMap::from([("name".into(), Value::String(text.into()))]);
        let bytes = view.write(&[row], &CancellationToken::new()).unwrap();
        assert!(
            std::str::from_utf8(&bytes)
                .unwrap()
                .contains(&format!("'{text}"))
        );
        assert_eq!(view.read(&bytes).unwrap()[0].1["name"], text);
        assert_eq!(view.read(&bytes[3..]).unwrap()[0].1["name"], text);
    }
    assert_eq!(
        view.read(b"name\n\xff\xfe").unwrap_err().code(),
        ENCODING_INVALID
    );
}

#[test]
fn limits_json_shape_and_row_validation() {
    let mut spec = spec();
    spec.limits.file_bytes = 10;
    assert_eq!(
        exchange(&spec, ExchangeFormat::Csv)
            .read(b"name\n123456")
            .unwrap_err()
            .code(),
        FILE_TOO_LARGE
    );
    spec.limits = ExchangeLimits::default();
    spec.limits.import_rows = 1;
    assert_eq!(
        exchange(&spec, ExchangeFormat::Csv)
            .read(b"name\na\nb")
            .unwrap_err()
            .code(),
        TOO_MANY_ROWS
    );
    spec.limits.export_rows = 1;
    assert_eq!(
        exchange(&spec, ExchangeFormat::Json)
            .write(&[row(), row()], &CancellationToken::new())
            .unwrap_err()
            .code(),
        TOO_MANY_ROWS
    );
    let view = exchange(&spec, ExchangeFormat::Json);
    for document in [
        json!([]),
        json!({"rows":[]}),
        json!({"dataset":"test.rows","version":2,"exportedAt":"2026-10-17T00:00:00Z","rows":[]}),
    ] {
        assert_eq!(
            view.read(document.to_string().as_bytes())
                .unwrap_err()
                .code(),
            INPUT_INVALID
        );
    }
    for (dataset, rows, code) in [
        ("wrong", json!([]), DATASET_MISMATCH),
        ("test.rows", json!([{"name":"a","other":1}]), HEADER_INVALID),
    ] {
        let document =
            json!({"dataset":dataset,"version":1,"exportedAt":"2026-10-17T00:00:00Z","rows":rows});
        assert_eq!(
            view.read(document.to_string().as_bytes())
                .unwrap_err()
                .code(),
            code
        );
    }
    let (_, errors) = view.normalize(
        1,
        serde_json::from_value(json!({"name":"长".repeat(4097),"flag":"true","status":"禁用"}))
            .unwrap(),
    );
    assert_eq!(errors.len(), 3);
    assert_eq!(errors[0].code, CELL_TOO_LONG.as_str());
    let mut report = ImportReport::default();
    for row in 1..=201 {
        report.error(
            RowError::new(row, None, AppError::new(CONFLICT)),
            spec.limits,
        );
    }
    assert_eq!(report.errors.len(), 200);
    assert!(report.errors_truncated);
}

#[test]
fn xlsx_numeric_text_boolean_dates_and_dropdown_xml() {
    use calamine::{Data, Reader};
    let spec = spec();
    let view = exchange(&spec, ExchangeFormat::Xlsx);
    let bytes = view.write(&[row()], &CancellationToken::new()).unwrap();
    let mut book = calamine::Xlsx::new(std::io::Cursor::new(&bytes)).unwrap();
    let cells = book.worksheet_range_at(0).unwrap().unwrap();
    assert!(matches!(cells.get((1, 2)), Some(Data::Bool(true))));
    assert!(matches!(cells.get((1, 3)), Some(Data::DateTime(_))));
    let mut book = rust_xlsxwriter::Workbook::new();
    let sheet = book.add_worksheet();
    sheet.write_string(0, 0, "name").unwrap();
    sheet.write_number(1, 0, 42.0).unwrap();
    assert_eq!(
        view.read(&book.save_to_buffer().unwrap()).unwrap()[0].1["name"],
        "42"
    );
    let xml = String::from_utf8(xlsx_fixture(&bytes, None)).unwrap();
    assert!(xml.contains("<dataValidation type=\"list\""));
    assert!(xml.contains("F2:F10001"));
    assert!(xml.contains("启用"));
}

#[test]
fn partial_export_overwrites_only_on_success_and_cleans_failures_and_cancellation() {
    let root = tempfile::tempdir().unwrap();
    let path = root.path().join("rows.csv");
    let spec = spec();
    let view = exchange(&spec, ExchangeFormat::Csv);
    std::fs::write(&path, b"old").unwrap();
    let token = CancellationToken::new();
    token.cancel();
    assert_eq!(
        run::write_file(&view, &path, crate::id::Id::new(), &[row()], &token)
            .unwrap_err()
            .code(),
        crate::error::JOB_CANCELLED
    );
    let bad = BTreeMap::from([("name".into(), json!({}))]);
    assert!(
        run::write_file(
            &view,
            &path,
            crate::id::Id::new(),
            &[bad],
            &CancellationToken::new()
        )
        .is_err()
    );
    assert_eq!(std::fs::read(&path).unwrap(), b"old");
    assert_eq!(std::fs::read_dir(root.path()).unwrap().count(), 1);
    run::write_file(
        &view,
        &path,
        crate::id::Id::new(),
        &[row()],
        &CancellationToken::new(),
    )
    .unwrap();
    assert_eq!(view.read(&std::fs::read(&path).unwrap()).unwrap().len(), 1);
    assert_eq!(std::fs::read_dir(root.path()).unwrap().count(), 1);
}
