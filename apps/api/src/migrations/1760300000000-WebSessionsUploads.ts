import { MigrationInterface, QueryRunner } from 'typeorm';

export class WebSessionsUploads1760300000000 implements MigrationInterface {
  name = 'WebSessionsUploads1760300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "web_sessions" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "token_hash" character(64) NOT NULL,
        "expires_at" TIMESTAMP WITH TIME ZONE NOT NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "last_seen_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_web_sessions" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_web_sessions_token_hash"
      ON "web_sessions" ("token_hash")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_web_sessions_expires_at"
      ON "web_sessions" ("expires_at")
    `);

    await queryRunner.query(`
      CREATE TABLE "web_uploads" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "session_id" uuid NOT NULL,
        "object_key" character varying(512) NOT NULL,
        "content_type" character varying(64) NOT NULL,
        "byte_size" integer NOT NULL,
        "status" character varying(32) NOT NULL DEFAULT 'pending',
        "expires_at" TIMESTAMP WITH TIME ZONE NOT NULL,
        "job_id" uuid,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_web_uploads" PRIMARY KEY ("id"),
        CONSTRAINT "FK_web_uploads_session_id"
          FOREIGN KEY ("session_id") REFERENCES "web_sessions"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_web_uploads_object_key"
      ON "web_uploads" ("object_key")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_web_uploads_session_status"
      ON "web_uploads" ("session_id", "status")
    `);

    await queryRunner.query(`
      CREATE TABLE "web_job_requests" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "session_id" uuid NOT NULL,
        "idempotency_key" character varying(128) NOT NULL,
        "request_hash" character varying(64) NOT NULL,
        "job_id" uuid NOT NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_web_job_requests" PRIMARY KEY ("id"),
        CONSTRAINT "FK_web_job_requests_session_id"
          FOREIGN KEY ("session_id") REFERENCES "web_sessions"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_web_job_requests_job_id"
          FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_web_job_requests_session_idempotency"
      ON "web_job_requests" ("session_id", "idempotency_key")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "web_job_requests"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "web_uploads"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "web_sessions"`);
  }
}
