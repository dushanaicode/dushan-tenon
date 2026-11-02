use super::*;

#[tokio::test]
async fn progress_is_broadcast_throttled_flushed_and_fenced() {
    test_support::run(async |test| {
        let queue = queue(test, vec![success()]).await;
        let id = queue.submit(&test.db, input("test.one")).await.unwrap();
        let job = claim(&queue, id).await;
        let token = CancellationToken::new();
        let mut reporter = ProgressReporter::new(queue.clone(), job.clone(), token.clone());
        let mut events = queue.subscribe();
        let progress = |current| JobProgress {
            current: Some(current),
            total: Some(10),
            message_key: Some("test.progress".into()),
            params: Default::default(),
        };
        reporter.report(progress(1)).await.unwrap();
        let first = queue.get(id).await.unwrap();
        reporter.test_elapsed_since_write = Some(Duration::from_millis(499));
        reporter.report(progress(2)).await.unwrap();
        let second = queue.get(id).await.unwrap();
        assert_eq!(first.row_version, second.row_version);
        assert_eq!(second.progress.current, Some(1));
        assert_eq!(events.recv().await.unwrap().progress.current, Some(1));
        assert_eq!(events.recv().await.unwrap().progress.current, Some(2));
        reporter.flush().await.unwrap();
        assert_eq!(queue.get(id).await.unwrap().progress.current, Some(2));
        reporter.test_elapsed_since_write = Some(Duration::from_millis(500));
        reporter.report(progress(3)).await.unwrap();
        assert_eq!(queue.get(id).await.unwrap().progress.current, Some(3));
        test.db
            .execute(&store::update(id).value("lease_owner", "other").to_owned())
            .await
            .unwrap();
        reporter.test_elapsed_since_write = Some(Duration::ZERO);
        reporter.report(progress(4)).await.unwrap();
        assert_eq!(reporter.flush().await.unwrap_err().code(), JOB_CANCELLED);
        assert!(token.is_cancelled());
        assert_eq!(queue.get(id).await.unwrap().progress.current, Some(3));
    })
    .await;
}

#[tokio::test]
async fn job_schema_matches_across_dialects() {
    test_support::assert_migrated_schema(crate::migrations::MIGRATIONS).await;
}
