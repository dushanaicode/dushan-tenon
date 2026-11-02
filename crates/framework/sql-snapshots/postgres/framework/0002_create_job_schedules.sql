CREATE TABLE "fw_job_schedule" ( "id" varchar(36) NOT NULL PRIMARY KEY, "key" varchar(128) NOT NULL, "kind" varchar(128) NOT NULL, "cron" varchar(128) NOT NULL, "timezone" varchar(64) NOT NULL, "payload" text NOT NULL, "enabled" bool NOT NULL, "next_run_at" bigint, "last_run_at" bigint, "last_job_id" varchar(36), "updated_by" varchar(36), "created_at" bigint NOT NULL, "updated_at" bigint NOT NULL, "row_version" bigint NOT NULL );
CREATE UNIQUE INDEX "ux_fw_job_schedule_key" ON "fw_job_schedule" ("key");
CREATE INDEX "ix_fw_job_schedule_due" ON "fw_job_schedule" ("enabled", "next_run_at");
