import { sql } from "drizzle-orm";
import { index, integer, jsonb, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

export const userRole = pgEnum("user_role", ["uploader", "reviewer", "admin"]);

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  passwordHash: text("password_hash").notNull(),
  role: userRole("role").notNull().default("uploader"),
  createdAt: createdAt(),
});

export const sessions = pgTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("sessions_user_id_idx").on(t.userId)],
);

export const documentStatus = pgEnum("document_status", [
  "queued",
  "processing",
  "extracted",
  "failed",
  "approved",
  "rejected",
]);

export const documents = pgTable(
  "documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    filename: text("filename").notNull(),
    mimeType: text("mime_type").notNull(),
    content: text("content").notNull(),
    status: documentStatus("status").notNull().default("queued"),
    extracted: jsonb("extracted"),
    uploadedBy: uuid("uploaded_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("documents_uploaded_by_idx").on(t.uploadedBy)],
);

export const documentEventType = pgEnum("document_event_type", [
  "uploaded",
  "extraction_queued",
  "extraction_started",
  "extraction_succeeded",
  "extraction_failed",
  "approved",
  "rejected",
]);

/**
 * Append-only audit log. Every status change writes one event in the same
 * transaction, so the log and the document state cannot diverge.
 */
export const documentEvents = pgTable(
  "document_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    actorId: uuid("actor_id").references(() => users.id, { onDelete: "set null" }),
    type: documentEventType("type").notNull(),
    fromStatus: documentStatus("from_status"),
    toStatus: documentStatus("to_status"),
    data: jsonb("data"),
    // clock_timestamp() rather than now(): events written in one transaction keep their order.
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
  },
  (t) => [index("document_events_document_id_created_at_idx").on(t.documentId, t.createdAt)],
);

export const jobStatus = pgEnum("job_status", ["queued", "running", "succeeded", "failed"]);

/**
 * PostgreSQL-backed job queue. Workers claim jobs with FOR UPDATE SKIP LOCKED,
 * so several workers can run concurrently without double-processing a job.
 */
export const jobs = pgTable(
  "jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    queue: text("queue").notNull(),
    payload: jsonb("payload").notNull(),
    status: jobStatus("status").notNull().default("queued"),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(5),
    runAt: timestamp("run_at", { withTimezone: true }).notNull().defaultNow(),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    lockedBy: text("locked_by"),
    lastError: text("last_error"),
    dedupeKey: text("dedupe_key"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("jobs_claim_idx").on(t.queue, t.runAt).where(sql`status = 'queued'`),
    uniqueIndex("jobs_active_dedupe_key_idx").on(t.queue, t.dedupeKey).where(sql`status in ('queued', 'running')`),
  ],
);

export type DocumentStatus = (typeof documentStatus.enumValues)[number];
export type UserRole = (typeof userRole.enumValues)[number];
export type DocumentEventType = (typeof documentEventType.enumValues)[number];
export type JobStatus = (typeof jobStatus.enumValues)[number];
