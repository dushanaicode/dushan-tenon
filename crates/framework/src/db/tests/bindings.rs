use std::error::Error;

use sea_query::Value;

use super::*;

#[tokio::test(flavor = "current_thread")]
async fn sqlite_connections_apply_pragmas_and_enforce_foreign_keys() {
    test_support::run_on(Dialect::Sqlite, async |test| {
        setup(test, Schema::ForeignKeys).await;
        let mut connections = Vec::new();
        for _ in 0..4 {
            let mut connection = test.sqlite_pool().acquire().await.unwrap();
            let (journal,): (String,) = sqlx::query_as("PRAGMA journal_mode")
                .fetch_one(&mut *connection)
                .await
                .unwrap();
            let (foreign_keys,): (i64,) = sqlx::query_as("PRAGMA foreign_keys")
                .fetch_one(&mut *connection)
                .await
                .unwrap();
            let (timeout,): (i64,) = sqlx::query_as("PRAGMA busy_timeout")
                .fetch_one(&mut *connection)
                .await
                .unwrap();
            let (synchronous,): (i64,) = sqlx::query_as("PRAGMA synchronous")
                .fetch_one(&mut *connection)
                .await
                .unwrap();
            assert_eq!(
                (journal.as_str(), foreign_keys, timeout, synchronous),
                ("wal", 1, 5_000, 1)
            );
            connections.push(connection);
        }
        drop(connections);
        let mut query = Query::insert();
        query
            .into_table("child")
            .columns(["parent_id"])
            .values([1_i64.into()])
            .unwrap();
        assert!(test.db.execute(&query).await.is_err());
    })
    .await;
}

#[tokio::test(flavor = "current_thread")]
async fn id_and_timestamp_columns_use_text_and_integer_and_validate_decoding() {
    test_support::run(async |test| {
        setup(test, Schema::Typed).await;
        let id = Id::new();
        let at = Timestamp::from_millis(-1).unwrap();
        // 同时验证新类型自身的 SQLx Encode 和 sea-query Value 转换。
        match &test.db.pool {
            pool::Pool::Sqlite(pool) => {
                sqlx::query("INSERT INTO typed(id, at) VALUES (?, ?)")
                    .bind(id)
                    .bind(at)
                    .execute(pool)
                    .await
                    .unwrap();
            }
            pool::Pool::Mysql(pool) => {
                sqlx::query("INSERT INTO typed(id, at) VALUES (?, ?)")
                    .bind(id)
                    .bind(at)
                    .execute(pool)
                    .await
                    .unwrap();
            }
            pool::Pool::Postgres(pool) => {
                sqlx::query("INSERT INTO typed(id, at) VALUES ($1, $2)")
                    .bind(id)
                    .bind(at)
                    .execute(pool)
                    .await
                    .unwrap();
            }
        }
        let mut insert = Query::insert();
        insert
            .into_table("typed")
            .columns(["id", "at"])
            .values([Expr::val(id), Expr::val(at)])
            .unwrap();
        test.db.execute(&insert).await.unwrap();
        let mut query = Query::select();
        query.columns(["id", "at"]).from("typed");
        let rows: Vec<(Id, Timestamp)> = test.db.fetch_all(&query).await.unwrap();
        assert_eq!(rows, vec![(id, at), (id, at)]);
        if test.db.dialect() == Dialect::Sqlite {
            let storage: Vec<(String, String)> =
                sqlx::query_as("SELECT typeof(id), typeof(at) FROM typed")
                    .fetch_all(test.sqlite_pool())
                    .await
                    .unwrap();
            assert!(
                storage
                    .iter()
                    .all(|row| row == &("text".to_owned(), "integer".to_owned()))
            );
        }
        test.db
            .execute(
                &Query::update()
                    .table("typed")
                    .value("id", "invalid")
                    .to_owned(),
            )
            .await
            .unwrap();
        assert!(test.db.fetch_all::<(Id, Timestamp)>(&query).await.is_err());
        test.db
            .execute(
                &Query::update()
                    .table("typed")
                    .value("id", id)
                    .value("at", i64::MAX)
                    .to_owned(),
            )
            .await
            .unwrap();
        assert!(test.db.fetch_all::<(Id, Timestamp)>(&query).await.is_err());
    })
    .await;
}

#[tokio::test(flavor = "current_thread")]
async fn supported_bindings_and_nulls_round_trip_without_sql_interpolation() {
    test_support::run(async |test| {
        #[derive(Debug, PartialEq, FromRow)]
        struct Bound {
            flag: Option<bool>,
            number: Option<i64>,
            real: Option<f64>,
            text: Option<String>,
            bytes: Option<Vec<u8>>,
        }
        setup(test, Schema::Bindings).await;
        let text = "'; DROP TABLE bindings; -- 中文🙂文本";
        for (seq, values) in [
            vec![
                true.into(),
                i64::MIN.into(),
                1.25_f64.into(),
                text.into(),
                vec![0_u8, 255, 128].into(),
            ],
            vec![
                Value::Bool(None),
                Value::BigInt(None),
                Value::Double(None),
                Value::String(None),
                Value::Bytes(None),
            ],
            vec![
                false.into(),
                i64::MAX.into(),
                (-3.5_f64).into(),
                "".into(),
                Vec::<u8>::new().into(),
            ],
        ]
        .into_iter()
        .enumerate()
        {
            let mut query = Query::insert();
            query
                .into_table("bindings")
                .columns(["seq", "flag", "number", "real", "text", "bytes"])
                .values(
                    std::iter::once(Expr::val(seq as i64)).chain(values.into_iter().map(Expr::val)),
                )
                .unwrap();
            test.db.execute(&query).await.unwrap();
        }
        let mut query = Query::select();
        query
            .columns(["flag", "number", "real", "text", "bytes"])
            .from("bindings")
            .order_by("seq", sea_query::Order::Asc);
        let rows: Vec<Bound> = test.db.fetch_all(&query).await.unwrap();
        assert_eq!(
            rows,
            vec![
                Bound {
                    flag: Some(true),
                    number: Some(i64::MIN),
                    real: Some(1.25),
                    text: Some(text.into()),
                    bytes: Some(vec![0, 255, 128])
                },
                Bound {
                    flag: None,
                    number: None,
                    real: None,
                    text: None,
                    bytes: None
                },
                Bound {
                    flag: Some(false),
                    number: Some(i64::MAX),
                    real: Some(-3.5),
                    text: Some(String::new()),
                    bytes: Some(Vec::new())
                },
            ]
        );
    })
    .await;
}

#[tokio::test(flavor = "current_thread")]
async fn smaller_integer_bindings_convert_losslessly_including_nulls() {
    test_support::run(async |test| {
        setup(test, Schema::Numbers).await;
        let cases = [
            (Value::TinyInt(Some(i8::MIN)), Some(i64::from(i8::MIN))),
            (Value::SmallInt(Some(i16::MIN)), Some(i64::from(i16::MIN))),
            (Value::Int(Some(i32::MIN)), Some(i64::from(i32::MIN))),
            (Value::TinyUnsigned(Some(u8::MAX)), Some(i64::from(u8::MAX))),
            (
                Value::SmallUnsigned(Some(u16::MAX)),
                Some(i64::from(u16::MAX)),
            ),
            (Value::Unsigned(Some(u32::MAX)), Some(i64::from(u32::MAX))),
            (Value::TinyInt(None), None),
            (Value::SmallInt(None), None),
            (Value::Int(None), None),
            (Value::TinyUnsigned(None), None),
            (Value::SmallUnsigned(None), None),
            (Value::Unsigned(None), None),
        ];
        let expected: Vec<_> = cases.iter().map(|(_, value)| (*value,)).collect();
        for (seq, (value, _)) in cases.into_iter().enumerate() {
            let mut query = Query::insert();
            query
                .into_table("numbers")
                .columns(["seq", "value"])
                .values([Expr::val(seq as i64), Expr::val(value)])
                .unwrap();
            test.db.execute(&query).await.unwrap();
        }
        let mut query = Query::select();
        query
            .column("value")
            .from("numbers")
            .order_by("seq", sea_query::Order::Asc);
        let actual: Vec<(Option<i64>,)> = test.db.fetch_all(&query).await.unwrap();
        assert_eq!(actual, expected);
    })
    .await;
}

#[tokio::test(flavor = "current_thread")]
async fn unsupported_bindings_report_internal_error_with_type_name() {
    test_support::run(async |test| {
        setup(test, Schema::Numbers).await;
        for (value, name) in [
            (Value::BigUnsigned(Some(1)), "u64"),
            (Value::BigUnsigned(None), "u64"),
            (Value::Float(Some(1.0)), "f32"),
            (Value::Float(None), "f32"),
            (Value::Char(Some('x')), "char"),
            (Value::Char(None), "char"),
            (
                Value::Enum(sea_query::OptionEnum::None("kind".into())),
                "Enum",
            ),
            (
                Value::Enum(sea_query::OptionEnum::Some(Box::new(sea_query::Enum {
                    type_name: "kind".into(),
                    value: "example".into(),
                }))),
                "Enum",
            ),
        ] {
            let mut query = Query::insert();
            query
                .into_table("numbers")
                .columns(["value"])
                .values([Expr::val(value)])
                .unwrap();
            let error = test.db.execute(&query).await.unwrap_err();
            assert_eq!(error.code, INTERNAL_UNEXPECTED);
            assert!(
                error.source().unwrap().to_string().contains(name),
                "{name}: {error:?}"
            );
        }
    })
    .await;
}
