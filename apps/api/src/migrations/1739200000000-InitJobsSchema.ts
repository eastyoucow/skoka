import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitJobsSchema1739200000000 implements MigrationInterface {
  name = 'InitJobsSchema1739200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "jobs" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "source" character varying(32) NOT NULL,
        "external_request_id" character varying(255) NOT NULL,
        "prompt" character varying(255) NOT NULL,
        "status" character varying(32) NOT NULL DEFAULT 'RECEIVED',
        "input_key" character varying(512),
        "output_key" character varying(512),
        "object_count" integer,
        "active_attempt_id" uuid,
        "next_attempt_at" TIMESTAMP WITH TIME ZONE,
        "lease_until" TIMESTAMP WITH TIME ZONE,
        "deadline_at" TIMESTAMP WITH TIME ZONE,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_jobs" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_jobs_source_external_request_id"
      ON "jobs" ("source", "external_request_id")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_jobs_status_next_attempt_at"
      ON "jobs" ("status", "next_attempt_at")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_jobs_status_lease_until"
      ON "jobs" ("status", "lease_until")
    `);

    await queryRunner.query(`
      CREATE TABLE "job_attempts" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "job_id" uuid NOT NULL,
        "attempt_number" integer NOT NULL,
        "modal_call_id" character varying(255),
        "status" character varying(32) NOT NULL DEFAULT 'PENDING',
        "error" text,
        "started_at" TIMESTAMP WITH TIME ZONE,
        "finished_at" TIMESTAMP WITH TIME ZONE,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_job_attempts" PRIMARY KEY ("id"),
        CONSTRAINT "FK_job_attempts_job_id"
          FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_job_attempts_job_id_attempt_number"
      ON "job_attempts" ("job_id", "attempt_number")
    `);

    await queryRunner.query(`
      CREATE TABLE "deliveries" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "job_id" uuid NOT NULL,
        "channel" character varying(32) NOT NULL,
        "recipient_id" character varying(255) NOT NULL,
        "status" character varying(32) NOT NULL DEFAULT 'PENDING',
        "attempts" integer NOT NULL DEFAULT 0,
        "lease_until" TIMESTAMP WITH TIME ZONE,
        "next_retry_at" TIMESTAMP WITH TIME ZONE,
        "external_message_id" character varying(255),
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_deliveries" PRIMARY KEY ("id"),
        CONSTRAINT "FK_deliveries_job_id"
          FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_deliveries_job_channel_recipient"
      ON "deliveries" ("job_id", "channel", "recipient_id")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_deliveries_status_next_retry_at"
      ON "deliveries" ("status", "next_retry_at")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_deliveries_status_lease_until"
      ON "deliveries" ("status", "lease_until")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "deliveries"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "job_attempts"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "jobs"`);
  }
}
