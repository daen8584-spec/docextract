import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { documentEvents, documents, jobs } from "@/db/schema";
import { ExtractionError, extractInvoice } from "@/lib/extract";
import { EXTRACTION_QUEUE, extractionHandler } from "@/lib/extraction-job";
import { claimJob, enqueue } from "@/lib/queue";
import { processNext } from "@/lib/worker";

vi.mock("@/lib/extract", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/extract")>();
  return { ...actual, extractInvoice: vi.fn() };
});

const FIELDS = { vendor: "Acme Supplies", invoiceNumber: "1042", totalAmount: 1250, currency: "USD", dueDate: "2026-12-01" };

async function queuedDocument(maxAttempts = 3) {
  const [doc] = await db
    .insert(documents)
    .values({ filename: "invoice.txt", mimeType: "text/plain", content: "Invoice 1042" })
    .returning();
  await enqueue(db, EXTRACTION_QUEUE, { documentId: doc.id }, { dedupeKey: doc.id, maxAttempts });
  return doc;
}

const runWorkerOnce = () => processNext(EXTRACTION_QUEUE, extractionHandler, "test-worker");
const makeRetryDue = () => db.execute(sql`update jobs set run_at = now()`);
const documentState = async (id: string) =>
  (await db.select({ status: documents.status, extracted: documents.extracted }).from(documents).where(eq(documents.id, id)))[0];
const eventTypes = async (id: string) =>
  (await db.select().from(documentEvents).where(eq(documentEvents.documentId, id)).orderBy(documentEvents.createdAt)).map(
    (e) => e.type,
  );

beforeEach(() => {
  vi.mocked(extractInvoice).mockReset();
});

describe("extraction worker", () => {
  it("extracts a queued document and records model metrics", async () => {
    vi.mocked(extractInvoice).mockResolvedValue({
      fields: FIELDS,
      model: "test-model",
      latencyMs: 840,
      usage: { promptTokens: 300, completionTokens: 60, totalTokens: 360 },
    });
    const doc = await queuedDocument();

    expect(await runWorkerOnce()).toBe(true);

    expect(await documentState(doc.id)).toEqual({ status: "extracted", extracted: FIELDS });
    expect(await eventTypes(doc.id)).toEqual(["extraction_started", "extraction_succeeded"]);
    const [success] = await db
      .select()
      .from(documentEvents)
      .where(eq(documentEvents.type, "extraction_succeeded"));
    expect(success.data).toMatchObject({ model: "test-model", latencyMs: 840, usage: { totalTokens: 360 } });
    expect((await db.select().from(jobs))[0].status).toBe("succeeded");
  });

  it("completes the job in the same transaction that stores the result", async () => {
    vi.mocked(extractInvoice).mockResolvedValue({
      fields: FIELDS,
      model: "test-model",
      latencyMs: 10,
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
    });
    const doc = await queuedDocument();
    const job = await claimJob(EXTRACTION_QUEUE, "test-worker");
    expect(job).not.toBeNull();

    // Before the worker's own completion step runs, the job is already done.
    await extractionHandler.run(job!);

    expect((await documentState(doc.id)).status).toBe("extracted");
    expect((await db.select().from(jobs))[0].status).toBe("succeeded");
  });

  it("returns false when nothing is due", async () => {
    expect(await runWorkerOnce()).toBe(false);
  });

  it("puts the document back in the queue when an attempt fails and retries remain", async () => {
    vi.mocked(extractInvoice).mockRejectedValueOnce(new ExtractionError("LLM returned HTTP 503"));
    const doc = await queuedDocument(3);

    await runWorkerOnce();

    expect((await documentState(doc.id)).status).toBe("queued");
    const [failure] = await db.select().from(documentEvents).where(eq(documentEvents.type, "extraction_failed"));
    expect(failure.data).toMatchObject({ attempt: 1, willRetry: true, error: "LLM returned HTTP 503" });
    expect((await db.select().from(jobs))[0]).toMatchObject({ status: "queued", attempts: 1 });
  });

  it("succeeds on a later attempt after a transient failure", async () => {
    vi.mocked(extractInvoice)
      .mockRejectedValueOnce(new ExtractionError("LLM request failed: timeout"))
      .mockResolvedValueOnce({ fields: FIELDS, model: "test-model", latencyMs: 500, usage: null });
    const doc = await queuedDocument(3);

    await runWorkerOnce();
    await makeRetryDue();
    await runWorkerOnce();

    expect((await documentState(doc.id)).status).toBe("extracted");
    expect(await eventTypes(doc.id)).toEqual([
      "extraction_started",
      "extraction_failed",
      "extraction_started",
      "extraction_succeeded",
    ]);
  });

  it("marks the document failed once all attempts are used", async () => {
    vi.mocked(extractInvoice).mockRejectedValue(new ExtractionError("LLM response was not valid JSON"));
    const doc = await queuedDocument(2);

    await runWorkerOnce();
    await makeRetryDue();
    await runWorkerOnce();

    expect((await documentState(doc.id)).status).toBe("failed");
    const failures = await db.select().from(documentEvents).where(eq(documentEvents.type, "extraction_failed"));
    expect(failures.map((f) => (f.data as { willRetry: boolean }).willRetry)).toEqual([true, false]);
    expect((await db.select().from(jobs))[0].status).toBe("failed");
  });

  it("skips documents that were reviewed while the job was waiting", async () => {
    const doc = await queuedDocument();
    await db.update(documents).set({ status: "rejected" }).where(eq(documents.id, doc.id));

    await runWorkerOnce();

    expect(extractInvoice).not.toHaveBeenCalled();
    expect((await documentState(doc.id)).status).toBe("rejected");
    expect((await db.select().from(jobs))[0].status).toBe("succeeded");
  });
});
