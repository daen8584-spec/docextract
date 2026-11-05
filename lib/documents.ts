import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { documentEvents, documents, users } from "../db/schema";
import { isReviewer, type SessionUser } from "./auth";
import { AppError } from "./errors";
import { ExtractionError, extractInvoiceFields, type InvoiceFields, invoiceFields } from "./extract";
import { diffFields } from "./fields";

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

export async function listDocumentEvents(user: SessionUser, id: string) {
  await getDocument(user, id);
  return db
    .select({
      id: documentEvents.id,
      type: documentEvents.type,
      fromStatus: documentEvents.fromStatus,
      toStatus: documentEvents.toStatus,
      data: documentEvents.data,
      createdAt: documentEvents.createdAt,
      actor: { id: users.id, name: users.name },
    })
    .from(documentEvents)
    .leftJoin(users, eq(documentEvents.actorId, users.id))
    .where(eq(documentEvents.documentId, id))
    .orderBy(asc(documentEvents.createdAt));
}

export async function createDocument(user: SessionUser, file: UploadedFile) {
  if (!ALLOWED_MIME_TYPES.has(file.type)) {
    throw new AppError("UNSUPPORTED_MEDIA_TYPE", `Unsupported type: ${file.type || "unknown"}`);
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new AppError("PAYLOAD_TOO_LARGE", "File exceeds 1 MB");
  }
  const content = await file.text();

  return db.transaction(async (tx) => {
    const [doc] = await tx
      .insert(documents)
      .values({ filename: file.name, mimeType: file.type, content, uploadedBy: user.id })
      .returning(summaryColumns);
    await tx.insert(documentEvents).values({
      documentId: doc.id,
      actorId: user.id,
      type: "uploaded",
      toStatus: doc.status,
      data: { filename: file.name, sizeBytes: file.size },
    });
    return doc;
  });
}

export async function extractDocument(user: SessionUser, id: string) {
  const [doc] = await db.select().from(documents).where(eq(documents.id, id)).limit(1);
  if (!doc) throw new AppError("NOT_FOUND", "Document not found");
  if (doc.status === "approved" || doc.status === "rejected") {
    throw new AppError("CONFLICT", `Document already ${doc.status}`);
  }

  let fields: InvoiceFields;
  try {
    fields = await extractInvoiceFields(doc.content);
  } catch (error) {
    if (!(error instanceof ExtractionError)) throw error;
    await db.insert(documentEvents).values({
      documentId: id,
      actorId: user.id,
      type: "extraction_failed",
      fromStatus: doc.status,
      toStatus: doc.status,
      data: { error: error.message },
    });
    throw new AppError("BAD_GATEWAY", error.message);
  }

  return db.transaction(async (tx) => {
    const [updated] = await tx
      .update(documents)
      .set({ status: "extracted", extracted: fields })
      .where(and(eq(documents.id, id), inArray(documents.status, ["pending", "extracted"])))
      .returning(resultColumns);
    if (!updated) throw new AppError("CONFLICT", "Document was reviewed during extraction");

    await tx.insert(documentEvents).values({
      documentId: id,
      actorId: user.id,
      type: "extraction_succeeded",
      fromStatus: doc.status,
      toStatus: "extracted",
    });
    return updated;
  });
}

/**
 * Applies a review atomically. The row is locked for the duration of the
 * transaction, so of two concurrent reviews exactly one succeeds and the other
 * sees the new status and fails with a conflict.
 */
export async function reviewDocument(user: SessionUser, id: string, review: Review) {
  return db.transaction(async (tx) => {
    const [doc] = await tx
      .select({ status: documents.status, extracted: documents.extracted })
      .from(documents)
      .where(eq(documents.id, id))
      .limit(1)
      .for("update");
    if (!doc) throw new AppError("NOT_FOUND", "Document not found");
    if (doc.status !== "extracted") {
      throw new AppError("CONFLICT", `Cannot review a document with status '${doc.status}'`);
    }

    const before = doc.extracted as InvoiceFields | null;
    const approved = review.action === "approve";
    const fields = approved && review.fields ? review.fields : before;
    const corrections = approved && review.fields ? diffFields(before, review.fields) : [];
    const toStatus = approved ? ("approved" as const) : ("rejected" as const);

    const [updated] = await tx
      .update(documents)
      .set({ status: toStatus, extracted: fields })
      .where(eq(documents.id, id))
      .returning(resultColumns);
    await tx.insert(documentEvents).values({
      documentId: id,
      actorId: user.id,
      type: toStatus,
      fromStatus: "extracted",
      toStatus,
      data: corrections.length > 0 ? { corrections } : null,
    });
    return updated;
  });
}
