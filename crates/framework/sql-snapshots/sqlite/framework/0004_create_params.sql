CREATE TABLE "fw_param" ( "id" varchar(36) NOT NULL PRIMARY KEY, "param_key" varchar(96) NOT NULL, "value" varchar(1024), "secret_set" boolean NOT NULL DEFAULT FALSE, "created_at" integer NOT NULL, "updated_at" integer NOT NULL, "row_version" integer NOT NULL, "created_by" varchar(36) NOT NULL, "updated_by" varchar(36) NOT NULL );
CREATE UNIQUE INDEX "ux_fw_param_key" ON "fw_param" ("param_key");
