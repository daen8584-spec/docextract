import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { documentEvents, documents, type OcrSummary } from "../db/schema";
import { extractInvoice, type ExtractionResult } from "./extract";
import { currentLogger } from "./logger";
import { OcrError, ocrPdf, ocrSettings } from "./ocr";
import { completeJob, type Job } from "./queue";
import { errorMessage, type QueueHandler } from "./worker";

export const EXTRACTION_QUEUE = "extract-document";

const payloadSchema = z.object({ documentId: z.uuid() });

/** Moves a document out of `processing` after a failed attempt, recording why. */
async function recordFailure(documentId: string, job: Job, error: string, toStatus: "queued" | "failed") {
  await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(documents)
      .set({ status: toStatus })
      .where(and(eq(documents.id, documentId), inArray(documents.status, ["queued", "processing"])))
      .returning({ id: documents.id });
    if (!updated) return;

    await tx.insert(documentEvents).values({
      documentId,
      type: "extraction_failed",
      fromStatus: "processing",
      toStatus,
      data: { jobId: job.id, attempt: job.attempts, error, willRetry: toStatus === "queued" },
    });
  });
}

/** Marks the document as processing. Returns null if it no longer awaits extraction. */
async function startExtraction(documentId: string, job: Job) {
  return db.transaction(async (tx) => {
    const [doc] = await tx
      .select({ status: documents.status, content: documents.content, originalPdf: documents.originalPdf })
      .from(documents)
      .where(eq(documents.id, documentId))
      .limit(1)
      .for("update");
    // `processing` is accepted so a job recovered from a crashed worker can resume.
    if (!doc || (doc.status !== "queued" && doc.status !== "processing")) return null;

    await tx.update(documents).set({ status: "processing" }).where(eq(documents.id, documentId));
    await tx.insert(documentEvents).values({
      documentId,
      type: "extraction_started",
      fromStatus: doc.status,
      toStatus: "processing",
      data: { jobId: job.id, attempt: job.attempts },
    });
    return doc;
  });
}

/**
 * Reads a scanned PDF with OCR and stores the text as the document content, clearing the
 * stored PDF. This commits before extraction, so a retry after an extraction failure
 * reuses the text instead of repeating OCR.
 */
async function runOcr(documentId: string, job: Job, pdf: Buffer): Promise<string> {
  const settings = ocrSettings();
  const started = performance.now();
  const result = await ocrPdf(pdf, settings);
  if (result.text.length === 0) throw new OcrError("OCR found no text in the document");
  const summary: OcrSummary = {
    pages: result.pages,
    meanConfidence: Math.round(result.meanConfidence * 10) / 10,
    lowConfidence: result.meanConfidence < settings.minConfidence,
  };
  await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(documents)
      .set({ content: result.text, originalPdf: null, ocr: summary })
      .where(and(eq(documents.id, documentId), eq(documents.status, "processing")))
      .returning({ id: documents.id });
    if (!updated) return;
    await tx.insert(documentEvents).values({
      documentId,
      type: "ocr_completed",
      data: { jobId: job.id, ...summary, words: result.words, durationMs: Math.round(performance.now() - started) },
    });
  });
  return result.text;
}

async function saveResult(documentId: string, job: Job, result: ExtractionResult) {
  await db.transaction(async (tx) => {
    // The job is completed in the same transaction as the result. Otherwise, between the
    // two, the document is already extracted while its job still counts as running, and a
    // re-extraction requested in that window would find no room for a new job.
    await completeJob(job.id, tx);
    const [updated] = await tx
      .update(documents)
      .set({ status: "extracted", extracted: result.fields })
      .where(and(eq(documents.id, documentId), eq(documents.status, "processing")))
      .returning({ id: documents.id });
    if (!updated) return;

    await tx.insert(documentEvents).values({
      documentId,
      type: "extraction_succeeded",
      fromStatus: "processing",
      toStatus: "extracted",
      data: { jobId: job.id, model: result.model, latencyMs: result.latencyMs, usage: result.usage },
    });
  });
}

export const extractionHandler: QueueHandler = {
  async run(job) {
    const { documentId } = payloadSchema.parse(job.payload);
    const doc = await startExtraction(documentId, job);
    if (!doc) {
      currentLogger().info({ documentId }, "document no longer awaits extraction, skipping");
      return;
    }

    let result: ExtractionResult;
    try {
      const content = doc.originalPdf ? await runOcr(documentId, job, doc.originalPdf) : doc.content;
      result = await extractInvoice(content);
    } catch (error) {
      // The final failure is recorded once, by onExhausted.
      if (job.attempts < job.maxAttempts) await recordFailure(documentId, job, errorMessage(error), "queued");
      throw error;
    }
    await saveResult(documentId, job, result);
  },

  async onExhausted(job, error) {
    const parsed = payloadSchema.safeParse(job.payload);
    if (parsed.success) await recordFailure(parsed.data.documentId, job, error, "failed");
  },
};
