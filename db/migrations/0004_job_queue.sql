CREATE TYPE "public"."job_status" AS ENUM('queued', 'running', 'succeeded', 'failed');--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"queue" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" "job_status" DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"run_at" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_at" timestamp with time zone,
	"locked_by" text,
	"last_error" text,
	"dedupe_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "jobs_claim_idx" ON "jobs" USING btree ("queue","run_at") WHERE status = 'queued';--> statement-breakpoint
CREATE UNIQUE INDEX "jobs_active_dedupe_key_idx" ON "jobs" USING btree ("queue","dedupe_key") WHERE status in ('queued', 'running');--> statement-breakpoint
ALTER TYPE "public"."document_status" RENAME TO "document_status_old";--> statement-breakpoint
CREATE TYPE "public"."document_status" AS ENUM('queued', 'processing', 'extracted', 'failed', 'approved', 'rejected');--> statement-breakpoint
ALTER TABLE "documents" ALTER COLUMN "status" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "documents" ALTER COLUMN "status" SET DATA TYPE "public"."document_status" USING (CASE "status"::text WHEN 'pending' THEN 'queued' ELSE "status"::text END)::"public"."document_status";--> statement-breakpoint
ALTER TABLE "documents" ALTER COLUMN "status" SET DEFAULT 'queued';--> statement-breakpoint
ALTER TABLE "document_events" ALTER COLUMN "from_status" SET DATA TYPE "public"."document_status" USING (CASE "from_status"::text WHEN 'pending' THEN 'queued' ELSE "from_status"::text END)::"public"."document_status";--> statement-breakpoint
ALTER TABLE "document_events" ALTER COLUMN "to_status" SET DATA TYPE "public"."document_status" USING (CASE "to_status"::text WHEN 'pending' THEN 'queued' ELSE "to_status"::text END)::"public"."document_status";--> statement-breakpoint
DROP TYPE "public"."document_status_old";--> statement-breakpoint
INSERT INTO "jobs" ("queue", "payload", "dedupe_key") SELECT 'extract-document', jsonb_build_object('documentId', "id"), "id"::text FROM "documents" WHERE "status" = 'queued';
