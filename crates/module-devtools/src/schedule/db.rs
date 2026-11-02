use super::*;
use crate::db::setup;
use sea_query::{Expr, ExprTrait, Query};
use tenon_framework::{
    db::test_support, error::DATA_NOT_FOUND, ipc::ActorResolver, time::Timestamp,
};

#[tokio::test]
async fn schedule_commands_list_and_submit_as_user() {
    test_support::run(async |test| {
        let (system, registry, queue) = setup(test).await;
        queue.sync_schedules(Timestamp::now()).await.unwrap();
        let context = ExecutionContext::new(
            system.resolve_active().await.unwrap().actor,
            "schedule-test",
        );
        let row = list(&queue).await.unwrap().remove(0);
        assert!(row.declared && row.enabled);
        assert_eq!(row.key, "sample.cleanup_daily");
        let submitted = run_now(&queue, &context, ScheduleId { id: row.id })
            .await
            .unwrap();
        let job = queue.get(submitted.job_id).await.unwrap();
        assert_eq!(job.submitted_by, user(&context));
        assert_eq!(job.kind, "sample.cleanup");
        assert_eq!(list(&queue).await.unwrap()[0].next_run_at, row.next_run_at);
        assert_eq!(
            run_now(&queue, &context, ScheduleId { id: Id::new() })
                .await
                .unwrap_err()
                .code(),
            DATA_NOT_FOUND
        );
        test.db
            .execute(
                &Query::update()
                    .table("fw_job_schedule")
                    .value("key", "system.removed")
                    .and_where(Expr::col("id").eq(row.id))
                    .to_owned(),
            )
            .await
            .unwrap();
        assert!(!list(&queue).await.unwrap()[0].declared);
        assert_eq!(
            run_now(&queue, &context, ScheduleId { id: row.id })
                .await
                .unwrap_err()
                .code(),
            UNDECLARED
        );
        registry.stop().await.unwrap();
    })
    .await;
}
