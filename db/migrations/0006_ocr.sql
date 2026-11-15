ALTER TYPE "public"."document_event_type" ADD VALUE 'ocr_completed' BEFORE 'extraction_succeeded';--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "original_pdf" "bytea";--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "ocr" jsonb;