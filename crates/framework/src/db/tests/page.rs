use super::*;
use crate::error::INPUT_INVALID;
use sea_query::Order;

#[tokio::test(flavor = "current_thread")]
async fn pagination_counts_filtered_rows_and_orders_ties_on_every_page() {
    test_support::run(async |test| {
        setup(test, Schema::Records).await;
        let mut ids = Vec::new();
        for key in ["a", "b", "c", "d", "e"] {
            ids.push(insert_record(&test.db, key).await);
        }
        test.db
            .execute(
                &Query::update()
                    .table(RECORDS.name)
                    .value("created_at", 42_i64)
                    .to_owned(),
            )
            .await
            .unwrap();
        test.db
            .soft_delete_by_id(RECORDS, &context(), ids[4], Some(1))
            .await
            .unwrap();
        let query = select(RECORDS)
            .into_query()
            .clear_selects()
            .column("id")
            .to_owned();
        let order = [("created_at", Order::Asc), ("id", Order::Asc)];
        ids.sort();
        for (page, expected) in [
            (1, &ids[..3]),
            (2, &ids[3..4]),
            (3, &ids[0..0]),
            (u32::MAX, &ids[0..0]),
        ] {
            let result: Page<(Id,)> = test
                .db
                .fetch_page(&query, PageRequest { page, page_size: 3 }, &order)
                .await
                .unwrap();
            assert_eq!(
                result.items.into_iter().map(|(id,)| id).collect::<Vec<_>>(),
                expected
            );
            assert_eq!((result.total, result.page, result.page_size), (4, page, 3));
        }
        for (request, path) in [
            (
                PageRequest {
                    page: 0,
                    page_size: 1,
                },
                "page",
            ),
            (
                PageRequest {
                    page: 1,
                    page_size: 0,
                },
                "pageSize",
            ),
            (
                PageRequest {
                    page: 1,
                    page_size: 101,
                },
                "pageSize",
            ),
        ] {
            let error = test
                .db
                .fetch_page::<(Id,)>(&query, request, &order)
                .await
                .unwrap_err();
            assert_eq!(
                format!("{error:?}"),
                format!(
                    "{:?}",
                    AppError::new(INPUT_INVALID).with_param("path", path)
                )
            );
        }
        assert_eq!(
            test.db
                .fetch_page::<(Id,)>(
                    &query,
                    PageRequest {
                        page: 1,
                        page_size: 100
                    },
                    &[]
                )
                .await
                .unwrap_err()
                .code(),
            INTERNAL_UNEXPECTED
        );
        let query = query
            .clone()
            .and_where(Expr::col("business_key").eq("b"))
            .to_owned();
        let result: Page<(Id,)> = test
            .db
            .fetch_page(
                &query,
                PageRequest {
                    page: 1,
                    page_size: 100,
                },
                &order,
            )
            .await
            .unwrap();
        assert_eq!((result.total, result.items.len()), (1, 1));
    })
    .await;
}

#[tokio::test(flavor = "current_thread")]
async fn contains_escapes_percent_underscore_backslash_and_escape_character() {
    test_support::run(async |test| {
        setup(test, Schema::Records).await;
        for key in ["a%b", "a_b", r"a\b", "a!b", "axb", r"a!%_\b"] {
            insert_record(&test.db, key).await;
        }
        for (keyword, expected) in [
            ("%", vec!["a%b", r"a!%_\b"]),
            ("_", vec!["a_b", r"a!%_\b"]),
            (r"\", vec![r"a\b", r"a!%_\b"]),
            ("!", vec!["a!b", r"a!%_\b"]),
            (r"!%_\", vec![r"a!%_\b"]),
            ("missing", vec![]),
        ] {
            let query = select(RECORDS)
                .into_query()
                .clear_selects()
                .column("business_key")
                .and_where(Expr::col("business_key").like(contains_literal(keyword)))
                .to_owned();
            let page: Page<(String,)> = test
                .db
                .fetch_page(
                    &query,
                    PageRequest {
                        page: 1,
                        page_size: 100,
                    },
                    &[("id", Order::Asc)],
                )
                .await
                .unwrap();
            assert_eq!(page.total, expected.len() as i64);
            let mut actual: Vec<_> = page.items.into_iter().map(|(key,)| key).collect();
            let mut expected = expected;
            actual.sort();
            expected.sort();
            assert_eq!(actual, expected, "{keyword}");
        }
    })
    .await;
}
