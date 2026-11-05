CREATE TYPE "public"."document_event_type" AS ENUM('uploaded', 'extraction_queued', 'extraction_started', 'extraction_succeeded', 'extraction_failed', 'approved', 'rejected');--> statement-breakpoint
CREATE TABLE "document_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"actor_id" uuid,
	"type" "document_event_type" NOT NULL,
	"from_status" "document_status",
	"to_status" "document_status",
	"data" jsonb,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "document_events" ADD CONSTRAINT "document_events_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_events" ADD CONSTRAINT "document_events_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "document_events_document_id_created_at_idx" ON "document_events" USING btree ("document_id","created_at");
