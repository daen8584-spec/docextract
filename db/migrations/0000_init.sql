CREATE TYPE "public"."document_status" AS ENUM('pending', 'extracted', 'approved', 'rejected');--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"filename" text NOT NULL,
	"status" "document_status" DEFAULT 'pending' NOT NULL,
	"extracted" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
