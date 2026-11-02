use std::{collections::BTreeMap, path::Path};

use sea_query::{Expr, ExprTrait, Order, Query};
use serde_json::{Map, Value};
use tenon_framework::{
    actor::ExecutionContext,
    db::{Db, Page, PageRequest, Tx},
    error::{AppError, INTERNAL_UNEXPECTED},
    exchange::{
        self, ColumnKind, DictResolver, Exchange, ExchangeColumn, ExchangeDataset, ExchangeFormat,
        ExchangeLimits, ExchangeRow, ImportColumn, ImportMode,
        run::{self, ExchangeFuture, ExportDataset, ImportDataset, WriteOutcome},
    },
    i18n::{Language, Translator},
    id::Id,
    job::JobContext,
};
use tenon_module_account::AccountService;

use crate::{
    DemoExportOptions, DemoImportMode, DemoImportOptions, DemoSampleCreate, DemoSampleStage,
    DemoService, jobs, safe_error, samples, user,
};

const COLUMNS: &[ExchangeColumn] = &[
    ExchangeColumn {
        key: "code",
        label_key: "demo.sample.code",
        kind: ColumnKind::Text { max_chars: 32 },
        import: ImportColumn::Required,
        dict: None,
    },
    ExchangeColumn {
        key: "title",
        label_key: "demo.sample.title",
        kind: ColumnKind::Text { max_chars: 120 },
        import: ImportColumn::Required,
        dict: None,
    },
    ExchangeColumn {
        key: "note",
        label_key: "demo.sample.note",
        kind: ColumnKind::Text { max_chars: 4096 },
        import: ImportColumn::Optional,
        dict: None,
    },
    ExchangeColumn {
        key: "stage",
        label_key: "demo.sample.stage",
        kind: ColumnKind::Text { max_chars: 64 },
        import: ImportColumn::Ignored,
        dict: Some("demo.sample_stage"),
    },
];

pub(crate) fn dataset() -> ExchangeDataset {
    ExchangeDataset {
        code: "demo.sample",
        columns: COLUMNS,
        modes: &[ImportMode::Error, ImportMode::Skip],
        limits: ExchangeLimits::default(),
    }
}

impl DemoService {
    /// 宿主提交导出任务前调用；返回的语言须随领域选项保存在任务载荷中。
    pub fn prepare_export(
        &self,
        execution: &ExecutionContext,
        options: &DemoExportOptions,
    ) -> Result<Language, AppError> {
        let (_, preferences) = self.enter(execution)?;
        samples::validate_filter(options.keyword.as_deref())?;
        Ok(preferences.language)
    }

    /// 宿主提交导入任务前调用；文件接入、一次性句柄与队列提交由宿主负责。
    pub fn prepare_import(&self, execution: &ExecutionContext) -> Result<Language, AppError> {
        Ok(self.enter(execution)?.1.language)
    }
}

pub(crate) struct Resolver<'a>(pub &'a dyn Translator);

impl Resolver<'_> {
    fn label_for(&self, value: &str, language: Language) -> Result<String, AppError> {
        self.0.text_in(
            language,
            &format!("dict.demo.sample_stage.{value}"),
            &Map::new(),
        )
    }
}

impl DictResolver for Resolver<'_> {
    fn label(&self, code: &str, value: &str, language: Language) -> Result<String, AppError> {
        if code != "demo.sample_stage"
            || !DemoSampleStage::ITEMS
                .iter()
                .any(|item| item.value == value)
        {
            return Err(AppError::new(exchange::DICT_VALUE_UNKNOWN));
        }
        self.label_for(value, language)
    }
    fn value(&self, code: &str, value: &str) -> Result<Option<String>, AppError> {
        if code != "demo.sample_stage" {
            return Err(AppError::new(INTERNAL_UNEXPECTED));
        }
        for item in DemoSampleStage::ITEMS {
            if item.value == value
                || self.label_for(item.value, Language::ZhCn)? == value
                || self.label_for(item.value, Language::EnUs)? == value
            {
                return Ok(Some(item.value.into()));
            }
        }
        Ok(None)
    }
    fn labels(&self, code: &str, language: Language) -> Result<Vec<String>, AppError> {
        DemoSampleStage::ITEMS
            .iter()
            .map(|item| self.label(code, item.value, language))
            .collect()
    }
}

struct SampleExport<'a> {
    db: &'a Db,
    owner: Id,
    options: &'a DemoExportOptions,
}

impl ExportDataset for SampleExport<'_> {
    type Record = samples::SampleRow;
    fn page(&self, request: PageRequest) -> ExchangeFuture<'_, Page<Self::Record>> {
        Box::pin(async move {
            self.db
                .fetch_page(
                    &samples::filtered(
                        self.owner,
                        self.options.keyword.as_deref(),
                        self.options.stage,
                    ),
                    request,
                    &[("created_at", Order::Desc), ("id", Order::Desc)],
                )
                .await
                .map_err(safe_error)
        })
    }
    fn rows(&self, records: Vec<Self::Record>) -> ExchangeFuture<'_, Vec<ExchangeRow>> {
        Box::pin(async move {
            Ok(records
                .into_iter()
                .map(|row| {
                    BTreeMap::from([
                        ("code".into(), Value::String(row.code)),
                        ("title".into(), Value::String(row.title)),
                        ("note".into(), Value::String(row.note)),
                        ("stage".into(), Value::String(row.stage.as_str().into())),
                    ])
                })
                .collect())
        })
    }
}

struct SampleImport<'a> {
    account: &'a AccountService,
    mode: ImportMode,
    existing: std::collections::BTreeSet<String>,
}

impl ImportDataset for SampleImport<'_> {
    type Prepared = DemoSampleCreate;
    #[expect(
        clippy::expect_used,
        reason = "framework run::import 仅在 normalize 无错误后调用 key，必填 Text code 已保证为字符串"
    )]
    fn key(&self, row: &ExchangeRow) -> String {
        row["code"]
            .as_str()
            .expect("normalized required code")
            .into()
    }
    fn validate(&mut self, row: &ExchangeRow) -> Result<Self::Prepared, AppError> {
        let input = DemoSampleCreate {
            code: row["code"]
                .as_str()
                .ok_or_else(|| AppError::new(INTERNAL_UNEXPECTED))?
                .into(),
            title: row["title"]
                .as_str()
                .ok_or_else(|| AppError::new(INTERNAL_UNEXPECTED))?
                .into(),
            // Optional 文本列的空值为 null，业务 note 的明确缺省为空字符串。
            note: row["note"].as_str().unwrap_or("").into(),
        };
        samples::validate_create(&input)?;
        if self.mode == ImportMode::Error && self.existing.contains(&input.code) {
            return Err(AppError::new(exchange::CONFLICT).with_param("path", "code"));
        }
        Ok(input)
    }
    fn write<'a>(
        &'a self,
        tx: &'a mut Tx<'_>,
        execution: &'a ExecutionContext,
        row: &'a Self::Prepared,
    ) -> ExchangeFuture<'a, WriteOutcome> {
        Box::pin(async move {
            let owner = user(execution)?;
            self.account
                .lock_owner_in_tx(tx)
                .await
                .map_err(safe_error)?;
            if samples::code_exists(tx, owner, &row.code).await? {
                return if self.mode == ImportMode::Skip {
                    Ok(WriteOutcome::Skipped)
                } else {
                    Err(AppError::new(exchange::CONFLICT))
                };
            }
            samples::insert(tx, owner, row).await?;
            Ok(WriteOutcome::Created)
        })
    }
}

impl DemoService {
    /// 执行已提交的导出；宿主处理器先核验权限并消费句柄，再传入路径。
    /// 不重新读取开发者模式或语言，关闭模式不终止已提交任务。
    pub async fn run_export(
        &self,
        context: &JobContext,
        path: &Path,
        format: ExchangeFormat,
        options: &DemoExportOptions,
        language: Language,
    ) -> Result<Value, AppError> {
        jobs::require_permissions(
            &self.account,
            &context.execution,
            &["demo.sample.read", "demo.sample.export"],
        )
        .await?;
        let owner = user(&context.execution)?;
        let started = self.started()?;
        let spec = dataset();
        let resolver = Resolver(started.translator.as_ref());
        let exchange = Exchange {
            dataset: &spec,
            format,
            language,
            translator: started.translator.as_ref(),
            dictionaries: &resolver,
        };
        run::export(
            context,
            &exchange,
            path,
            &SampleExport {
                db: &context.db,
                owner,
                options,
            },
        )
        .await
        .map_err(safe_error)
    }

    /// 执行已提交的导入；保留完整行校验与全部写入的单事务语义。
    pub async fn run_import(
        &self,
        context: &JobContext,
        path: &Path,
        format: ExchangeFormat,
        options: &DemoImportOptions,
        language: Language,
    ) -> Result<Value, AppError> {
        jobs::require_permissions(
            &self.account,
            &context.execution,
            &["demo.sample.write", "demo.sample.import"],
        )
        .await?;
        let owner = user(&context.execution)?;
        let started = self.started()?;
        let spec = dataset();
        let resolver = Resolver(started.translator.as_ref());
        let exchange = Exchange {
            dataset: &spec,
            format,
            language,
            translator: started.translator.as_ref(),
            dictionaries: &resolver,
        };
        let existing: Vec<(String,)> = context
            .db
            .fetch_all(
                &Query::select()
                    .column("code")
                    .from(samples::TABLE)
                    .and_where(Expr::col("created_by").eq(owner))
                    .to_owned(),
            )
            .await
            .map_err(safe_error)?;
        let mode = match options.mode {
            DemoImportMode::Error => ImportMode::Error,
            DemoImportMode::Skip => ImportMode::Skip,
        };
        run::import(
            context,
            &exchange,
            path,
            mode,
            &mut SampleImport {
                account: &self.account,
                mode,
                existing: existing.into_iter().map(|(code,)| code).collect(),
            },
        )
        .await
        .map_err(safe_error)
    }
}
