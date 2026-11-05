import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { documents } from "../db/schema";
import { isReviewer, type SessionUser } from "./auth";
import { AppError } from "./errors";
import { ExtractionError, extractInvoiceFields, invoiceFields } from "./extract";

export const MAX_UPLOAD_BYTES = 1_000_000;
export const ALLOWED_MIME_TYPES: ReadonlySet<string> = new Set(["text/plain"]);

export const reviewSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("approve"), fields: invoiceFields.optional() }),
  z.object({ action: z.literal("reject") }),
]);
export type Review = z.infer<typeof reviewSchema>;

type UploadedFile = { name: string; type: string; size: number; text(): Promise<string> };

const summaryColumns = {
  id: documents.id,
  filename: documents.filename,
  status: documents.status,
  createdAt: documents.createdAt,
};

const resultColumns = { id: documents.id, status: documents.status, extracted: documents.extracted };

/** Object-level authorization: uploaders only see their own documents, reviewers see all. */
const visibleTo = (user: SessionUser) => (isReviewer(user) ? undefined : eq(documents.uploadedBy, user.id));

export async function listDocuments(user: SessionUser, limit = 50) {
  return db
    .select(summaryColumns)
    .from(documents)
    .where(visibleTo(user))
    .orderBy(desc(documents.createdAt))
    .limit(limit);
}

/** Returns the document if it exists and the user may see it. Hidden documents are reported as not found. */
export async function getDocument(user: SessionUser, id: string) {
  const [doc] = await db
    .select()
    .from(documents)
    .where(and(eq(documents.id, id), visibleTo(user)))
    .limit(1);
  if (!doc) throw new AppError("NOT_FOUND", "Document not found");
  return doc;
}

export async function createDocument(user: SessionUser, file: UploadedFile) {
  if (!ALLOWED_MIME_TYPES.has(file.type)) {
    throw new AppError("UNSUPPORTED_MEDIA_TYPE", `Unsupported type: ${file.type || "unknown"}`);
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new AppError("PAYLOAD_TOO_LARGE", "File exceeds 1 MB");
  }

  const [doc] = await db
    .insert(documents)
    .values({ filename: file.name, mimeType: file.type, content: await file.text(), uploadedBy: user.id })
    .returning(summaryColumns);
  return doc;
}

export async function extractDocument(id: string) {
  const [doc] = await db.select().from(documents).where(eq(documents.id, id)).limit(1);
  if (!doc) throw new AppError("NOT_FOUND", "Document not found");
  if (doc.status === "approved" || doc.status === "rejected") {
    throw new AppError("CONFLICT", `Document already ${doc.status}`);
  }

  let fields;
  try {
    fields = await extractInvoiceFields(doc.content);
  } catch (error) {
    if (error instanceof ExtractionError) throw new AppError("BAD_GATEWAY", error.message);
    throw error;
  }

  const [updated] = await db
    .update(documents)
    .set({ status: "extracted", extracted: fields })
    .where(and(eq(documents.id, id), inArray(documents.status, ["pending", "extracted"])))
    .returning(resultColumns);
  if (!updated) throw new AppError("CONFLICT", "Document was reviewed during extraction");
  return updated;
}

/**
 * Applies a review atomically: the update only matches while the document is
 * still `extracted`, so concurrent reviews cannot overwrite each other.
 */
export async function reviewDocument(id: string, review: Review) {
  const changes =
    review.action === "approve"
      ? { status: "approved" as const, ...(review.fields && { extracted: review.fields }) }
      : { status: "rejected" as const };

  const [updated] = await db
    .update(documents)
    .set(changes)
    .where(and(eq(documents.id, id), eq(documents.status, "extracted")))
    .returning(resultColumns);
  if (updated) return updated;

  const [existing] = await db.select({ status: documents.status }).from(documents).where(eq(documents.id, id)).limit(1);
  if (!existing) throw new AppError("NOT_FOUND", "Document not found");
  throw new AppError("CONFLICT", `Cannot review a document with status '${existing.status}'`);
}
