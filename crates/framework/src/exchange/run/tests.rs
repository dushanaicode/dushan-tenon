use super::*;
use crate::{
    actor::Actor,
    db::{
        Db,
        test_support::{self, TestDb},
    },
    id::Id,
    instance::InstanceId,
    job::{
        CancellationToken, JobFuture, JobHandler, JobQueue, JobRunner, JobStatus, JobsConfig,
        PermissionLookup, SubmitJob,
    },
    maintenance::OperationGate,
};
use sea_query::{Order, Query};
use std::{
    sync::{Arc, Mutex},
    time::Duration,
};

struct Handler(Box<dyn Fn(JobContext) -> JobFuture<'static> + Send + Sync>);
impl JobHandler for Handler {
    fn kind(&self) -> &'static str {
        "test.one"
    }
    fn permissions(&self) -> &'static [&'static str] {
        &[]
    }
    fn retry_safe(&self) -> bool {
        false
    }
    fn max_attempts(&self) -> i32 {
        1
    }
    fn run(&self, context: JobContext) -> JobFuture<'_> {
        (self.0)(context)
    }
}
fn success() -> Arc<dyn JobHandler> {
    Arc::new(Handler(Box::new(|_| Box::pin(async { Ok(json!({})) }))))
}
fn input(kind: &str) -> SubmitJob {
    SubmitJob {
        kind: kind.into(),
        payload: json!({}),
        priority: 0,
        run_after: None,
        submitted_by: None,
    }
}
async fn queue(test: &TestDb, handlers: Vec<Arc<dyn JobHandler>>) -> JobQueue {
    test.upgrade(crate::migrations::MIGRATIONS, 1)
        .await
        .unwrap();
    JobQueue::new(
        test.db.clone(),
        handlers,
        vec![],
        vec![],
        InstanceId::load_or_create(test.root.path()).unwrap(),
    )
    .unwrap()
}
struct NoDict;
impl DictResolver for NoDict {
    fn label(&self, _: &str, _: &str, _: crate::i18n::Language) -> Result<String, AppError> {
        panic!("unexpected dictionary lookup")
    }
    fn value(&self, _: &str, _: &str) -> Result<Option<String>, AppError> {
        panic!("unexpected dictionary lookup")
    }
    fn labels(&self, _: &str, _: crate::i18n::Language) -> Result<Vec<String>, AppError> {
        panic!("unexpected dictionary lookup")
    }
}

struct PagedJobs {
    queue: JobQueue,
    db: Db,
    requests: Mutex<Vec<u32>>,
    pages: Mutex<Vec<usize>>,
    grow: bool,
}

fn exchange(spec: &ExchangeDataset) -> Exchange<'_> {
    Exchange {
        dataset: spec,
        format: ExchangeFormat::Json,
        language: crate::i18n::Language::ZhCn,
        translator: &crate::i18n::TestTranslator,
        dictionaries: &NoDict,
    }
}
impl ExportDataset for PagedJobs {
    type Record = (Id,);
    fn page(&self, request: PageRequest) -> ExchangeFuture<'_, Page<Self::Record>> {
        Box::pin(async move {
            assert_eq!(request.page_size, 100);
            self.requests.lock().unwrap().push(request.page);
            self.db
                .fetch_page(
                    &Query::select().column("id").from("fw_job").to_owned(),
                    request,
                    &[("id", Order::Asc)],
                )
                .await
        })
    }
    fn rows(&self, records: Vec<Self::Record>) -> ExchangeFuture<'_, Vec<ExchangeRow>> {
        Box::pin(async move {
            let first_page = {
                let mut pages = self.pages.lock().unwrap();
                pages.push(records.len());
                pages.len() == 1
            };
            if self.grow && first_page {
                for _ in 0..10 {
                    self.queue.submit(&self.db, input("test.one")).await?;
                }
            }
            Ok(records
                .into_iter()
                .map(|(id,)| BTreeMap::from([("id".into(), json!(id))]))
                .collect())
        })
    }
}

#[tokio::test]
async fn exchange_export_checks_count_and_paginated_growth_before_replacing_file() {
    test_support::run(async |test| {
        let queue = queue(test, vec![success()]).await;
        let id = queue.submit(&test.db, input("test.one")).await.unwrap();
        for _ in 0..104 {
            queue.submit(&test.db, input("test.one")).await.unwrap();
        }
        let context = queue
            .test_context(id, CancellationToken::new())
            .await
            .unwrap();
        let mut spec = ExchangeDataset {
            code: "test.jobs",
            columns: &[ExchangeColumn {
                key: "id",
                label_key: "id",
                kind: ColumnKind::Text { max_chars: 36 },
                import: ImportColumn::Required,
                dict: None,
            }],
            modes: &[],
            limits: ExchangeLimits {
                export_rows: 104,
                ..Default::default()
            },
        };
        let dataset = PagedJobs {
            queue,
            db: test.db.clone(),
            requests: Mutex::new(vec![]),
            pages: Mutex::new(vec![]),
            grow: false,
        };
        let output = test.root.path().join("paged.json");
        std::fs::write(&output, b"original").unwrap();
        assert_eq!(
            export(&context, &exchange(&spec), &output, &dataset)
                .await
                .unwrap_err()
                .code(),
            TOO_MANY_ROWS
        );
        assert!(dataset.pages.lock().unwrap().is_empty());
        assert_eq!(*dataset.requests.lock().unwrap(), [1]);
        assert_eq!(std::fs::read(&output).unwrap(), b"original");

        spec.limits.export_rows = 105;
        dataset.requests.lock().unwrap().clear();
        let result = export(&context, &exchange(&spec), &output, &dataset)
            .await
            .unwrap();
        assert_eq!(result["rows"], 105);
        assert_eq!(*dataset.pages.lock().unwrap(), [100, 5]);
        assert_eq!(*dataset.requests.lock().unwrap(), [1, 2]);
        let previous = std::fs::read(&output).unwrap();
        let document: serde_json::Value = serde_json::from_slice(&previous).unwrap();
        let ids: Vec<_> = document["rows"]
            .as_array()
            .unwrap()
            .iter()
            .map(|row| row["id"].as_str().unwrap())
            .collect();
        assert_eq!(ids.len(), 105);
        assert!(ids.windows(2).all(|pair| pair[0] < pair[1]));

        spec.limits.export_rows = 110;
        let growing = PagedJobs {
            grow: true,
            requests: Mutex::new(vec![]),
            pages: Mutex::new(vec![]),
            ..dataset
        };
        let error = export(&context, &exchange(&spec), &output, &growing)
            .await
            .unwrap_err();
        assert_eq!(error.code(), TOO_MANY_ROWS);
        assert_eq!(error.params["max"], "110");
        assert_eq!(*growing.pages.lock().unwrap(), [100, 15]);
        assert_eq!(*growing.requests.lock().unwrap(), [1, 2]);
        assert_eq!(std::fs::read(&output).unwrap(), previous);
        assert!(!std::fs::read_dir(test.root.path()).unwrap().any(|entry| {
            entry
                .unwrap()
                .path()
                .extension()
                .is_some_and(|extension| extension == "partial")
        }));
    })
    .await;
}

#[tokio::test]
async fn export_over_limit_never_converts_rows() {
    test_support::run(async |test| {
        let queue = queue(test, vec![success()]).await;
        let id = queue.submit(&test.db, input("test.one")).await.unwrap();
        queue.submit(&test.db, input("test.one")).await.unwrap();
        let context = queue
            .test_context(id, CancellationToken::new())
            .await
            .unwrap();
        let spec = ExchangeDataset {
            code: "test.jobs",
            columns: &[ExchangeColumn {
                key: "id",
                label_key: "id",
                kind: ColumnKind::Text { max_chars: 36 },
                import: ImportColumn::Required,
                dict: None,
            }],
            modes: &[],
            limits: ExchangeLimits {
                export_rows: 1,
                ..Default::default()
            },
        };
        let dataset = PagedJobs {
            queue,
            db: test.db.clone(),
            requests: Mutex::new(vec![]),
            pages: Mutex::new(vec![]),
            grow: false,
        };
        let output = test.root.path().join("over-limit.json");
        assert_eq!(
            export(&context, &exchange(&spec), &output, &dataset)
                .await
                .unwrap_err()
                .code(),
            TOO_MANY_ROWS
        );
        assert!(dataset.pages.lock().unwrap().is_empty());
        assert_eq!(*dataset.requests.lock().unwrap(), [1]);
        assert!(!output.exists());
        assert!(!std::fs::read_dir(test.root.path()).unwrap().any(|entry| {
            entry
                .unwrap()
                .path()
                .extension()
                .is_some_and(|extension| extension == "partial")
        }));
    })
    .await;
}

#[tokio::test]
async fn export_cancellation_after_conversion_stops_before_the_next_page_and_preserves_the_file() {
    struct CancelAfterRows(CancellationToken, Mutex<Vec<u32>>);
    impl ExportDataset for CancelAfterRows {
        type Record = ();
        fn page(&self, request: PageRequest) -> ExchangeFuture<'_, Page<()>> {
            Box::pin(async move {
                self.1.lock().unwrap().push(request.page);
                assert_eq!(request.page_size, 100);
                Ok(Page {
                    items: vec![()],
                    total: 101,
                    page: request.page,
                    page_size: request.page_size,
                })
            })
        }
        fn rows(&self, _: Vec<()>) -> ExchangeFuture<'_, Vec<ExchangeRow>> {
            Box::pin(async move {
                self.0.cancel();
                Ok(vec![BTreeMap::from([("name".into(), json!("first"))])])
            })
        }
    }
    test_support::run(async |test| {
        let queue = queue(test, vec![success()]).await;
        let id = queue.submit(&test.db, input("test.one")).await.unwrap();
        let token = CancellationToken::new();
        let context = queue.test_context(id, token.clone()).await.unwrap();
        let path = test.root.path().join("cancelled.json");
        std::fs::write(&path, b"original").unwrap();
        let dataset = CancelAfterRows(token, Mutex::new(vec![]));
        let error = export(&context, &exchange(&import_spec()), &path, &dataset)
            .await
            .unwrap_err();
        assert_eq!(error.code(), JOB_CANCELLED);
        assert_eq!(*dataset.1.lock().unwrap(), [1]);
        assert_eq!(std::fs::read(&path).unwrap(), b"original");
        assert!(!std::fs::read_dir(test.root.path()).unwrap().any(|entry| {
            entry
                .unwrap()
                .path()
                .extension()
                .is_some_and(|extension| extension == "partial")
        }));
    })
    .await;
}

fn import_spec() -> ExchangeDataset {
    ExchangeDataset {
        code: "test.import",
        columns: &[ExchangeColumn {
            key: "name",
            label_key: "name",
            kind: ColumnKind::Text { max_chars: 64 },
            import: ImportColumn::Required,
            dict: None,
        }],
        modes: &[ImportMode::Error],
        limits: ExchangeLimits::default(),
    }
}

fn import_exchange(spec: &ExchangeDataset) -> Exchange<'_> {
    Exchange {
        format: ExchangeFormat::Csv,
        ..exchange(spec)
    }
}

#[derive(Default)]
struct Rows {
    validated: Vec<String>,
    fail_on_write: Option<&'static str>,
    cancel_after_write: Option<CancellationToken>,
}

impl ImportDataset for Rows {
    type Prepared = String;

    fn key(&self, row: &ExchangeRow) -> String {
        row["name"].as_str().unwrap().into()
    }

    fn validate(&mut self, row: &ExchangeRow) -> Result<String, AppError> {
        let name = self.key(row);
        self.validated.push(name.clone());
        if name.starts_with("invalid") {
            return Err(AppError::new(CONFLICT).with_param("path", "name"));
        }
        Ok(name)
    }

    fn write<'a>(
        &'a self,
        tx: &'a mut Tx<'_>,
        _: &'a ExecutionContext,
        name: &'a String,
    ) -> ExchangeFuture<'a, WriteOutcome> {
        Box::pin(async move {
            if self.fail_on_write == Some(name.as_str()) {
                return Err(AppError::new(CONFLICT));
            }
            tx.execute(
                &Query::insert()
                    .into_table("exchange_rows")
                    .columns(["name"])
                    .values_panic([name.clone().into()])
                    .to_owned(),
            )
            .await?;
            if let Some(token) = &self.cancel_after_write {
                token.cancel();
            }
            Ok(match name.as_str() {
                "updated" => WriteOutcome::Updated,
                "skipped" => WriteOutcome::Skipped,
                _ => WriteOutcome::Created,
            })
        })
    }
}

#[tokio::test]
async fn import_validates_every_row_before_writing_and_rejects_duplicates() {
    test_support::run(async |test| {
        let queue = queue(test, vec![success()]).await;
        test.raw("CREATE TABLE exchange_rows (name VARCHAR(64) NOT NULL)")
            .await;
        let file = test.root.path().join("rows.csv");
        let spec = import_spec();
        for (csv, validated) in [
            (
                "name\nfirst\ninvalid-row\nlast\n",
                vec!["first", "invalid-row", "last"],
            ),
            ("name\nfirst\nfirst\nlast\n", vec!["first", "last"]),
        ] {
            std::fs::write(&file, csv).unwrap();
            let id = queue.submit(&test.db, input("test.one")).await.unwrap();
            let context = queue
                .test_context(id, CancellationToken::new())
                .await
                .unwrap();
            let mut rows = Rows::default();
            let error = import(
                &context,
                &import_exchange(&spec),
                &file,
                ImportMode::Error,
                &mut rows,
            )
            .await
            .unwrap_err();
            assert_eq!(error.code(), ROWS_INVALID);
            assert_eq!(error.params["count"], "1");
            assert_eq!(rows.validated, validated);
            assert!(
                test.rows::<(String,)>("exchange_rows", &["name"])
                    .await
                    .is_empty()
            );
        }
    })
    .await;
}

#[tokio::test]
async fn import_commits_all_outcomes_together_and_rolls_back_write_failure_or_cancellation() {
    test_support::run(async |test| {
        let queue = queue(test, vec![success()]).await;
        test.raw("CREATE TABLE exchange_rows (name VARCHAR(64) NOT NULL)").await;
        let file = test.root.path().join("rows.csv");
        std::fs::write(&file, "name\ncreated\nupdated\nskipped\n").unwrap();
        let spec = import_spec();
        for cancel in [false, true] {
            let id = queue.submit(&test.db, input("test.one")).await.unwrap();
            let token = CancellationToken::new();
            let context = queue.test_context(id, token.clone()).await.unwrap();
            let mut rows = Rows {
                fail_on_write: (!cancel).then_some("updated"),
                cancel_after_write: cancel.then_some(token),
                ..Default::default()
            };
            let error = tokio::time::timeout(Duration::from_secs(5), import(&context, &import_exchange(&spec), &file, ImportMode::Error, &mut rows)).await.unwrap().unwrap_err();
            assert_eq!(error.code(), if cancel { JOB_CANCELLED } else { CONFLICT });
            assert_eq!(rows.validated, ["created", "updated", "skipped"]);
            assert!(test.rows::<(String,)>("exchange_rows", &["name"]).await.is_empty());
        }
        let id = queue.submit(&test.db, input("test.one")).await.unwrap();
        let context = queue.test_context(id, CancellationToken::new()).await.unwrap();
        let report = tokio::time::timeout(Duration::from_secs(5), import(&context, &import_exchange(&spec), &file, ImportMode::Error, &mut Rows::default())).await.unwrap().unwrap();
        assert_eq!(report, json!({"total": 3, "created": 1, "updated": 1, "skipped": 1, "errors": [], "errorsTruncated": false}));
        assert_eq!(test.rows::<(String,)>("exchange_rows", &["name"]).await.len(), 3);
    }).await;
}

struct Permission;
impl PermissionLookup for Permission {
    fn has_permission<'a>(
        &'a self,
        _: Actor,
        _: &'a str,
    ) -> Pin<Box<dyn Future<Output = Result<bool, AppError>> + Send + 'a>> {
        Box::pin(async { Ok(true) })
    }
}

#[tokio::test]
async fn import_failure_report_caps_details_and_persists_the_complete_error_count() {
    test_support::run(async |test| {
        let file = test.root.path().join("invalid.csv");
        let csv = "name\n".to_owned()
            + &(0..205)
                .map(|index| format!("invalid-{index}\n"))
                .collect::<String>();
        std::fs::write(&file, csv).unwrap();
        let handler = Arc::new(Handler(Box::new(move |context| {
            let file = file.clone();
            Box::pin(async move {
                import(
                    &context,
                    &import_exchange(&import_spec()),
                    &file,
                    ImportMode::Error,
                    &mut Rows::default(),
                )
                .await
            })
        })));
        let queue = queue(test, vec![handler]).await;
        test.raw("CREATE TABLE exchange_rows (name VARCHAR(64) NOT NULL)")
            .await;
        let id = queue.submit(&test.db, input("test.one")).await.unwrap();
        let runner = JobRunner::start(
            queue.clone(),
            Arc::new(Permission),
            JobsConfig::new(1, 10).unwrap(),
            OperationGate::default(),
        )
        .await
        .unwrap();
        let job = tokio::time::timeout(Duration::from_secs(5), async {
            loop {
                let job = queue.get(id).await.unwrap();
                if job.status.is_terminal() {
                    break job;
                }
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        })
        .await;
        runner.stop().await.unwrap();
        let job = job.unwrap();
        assert_eq!(job.status, JobStatus::Failed);
        assert_eq!(job.error_code.as_deref(), Some(ROWS_INVALID.as_str()));
        assert_eq!(job.error_params["count"], "205");
        let report = job.result.unwrap();
        assert_eq!(report["total"], 205);
        assert_eq!(report["errorsTruncated"], true);
        let errors = report["errors"].as_array().unwrap();
        assert_eq!(errors.len(), 200);
        assert_eq!(errors[0]["row"], 2);
        assert_eq!(errors[199]["row"], 201);
        assert!(
            errors
                .iter()
                .all(|error| error["code"] == CONFLICT.as_str() && error["column"] == "name")
        );
        assert!(
            test.rows::<(String,)>("exchange_rows", &["name"])
                .await
                .is_empty()
        );
    })
    .await;
}
