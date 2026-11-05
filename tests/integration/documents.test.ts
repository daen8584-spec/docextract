import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { POST as extractDocument } from "@/app/api/documents/[id]/extract/route";
import { GET as getDocument, PATCH as reviewDocument } from "@/app/api/documents/[id]/route";
import { GET as listDocuments, POST as uploadDocument } from "@/app/api/documents/route";
import { db } from "@/db";
import { documents, jobs } from "@/db/schema";
import type { InvoiceFields } from "@/lib/extract";
import { makePdf } from "../fixtures/pdf";
import { jsonRequest, routeParams, uploadRequest } from "./requests";
import { createUser } from "./users";

const FIELDS: InvoiceFields = {
  vendor: "Acme Supplies",
  invoiceNumber: "1042",
  totalAmount: 1250,
  currency: "USD",
  dueDate: "2026-12-01",
};

async function insertDocument(values: Partial<typeof documents.$inferInsert> = {}) {
  const [doc] = await db
    .insert(documents)
    .values({ filename: "invoice.txt", mimeType: "text/plain", content: "Invoice 1042", ...values })
    .returning();
  return doc;
}

async function statusOf(id: string) {
  const [row] = await db.select({ status: documents.status }).from(documents).where(eq(documents.id, id));
  return row?.status;
}

const review = (id: string, body: unknown, cookie: string) =>
  reviewDocument(jsonRequest("PATCH", `/api/documents/${id}`, body, { cookie }), routeParams(id));

describe("POST /api/documents", () => {
  it("requires authentication", async () => {
    const res = await uploadDocument(uploadRequest("invoice.txt", "Invoice 1042"), undefined);
    expect(res.status).toBe(401);
  });

  it("stores a valid upload owned by the uploader and queues its extraction", async () => {
    const { user, cookie } = await createUser();

    const res = await uploadDocument(uploadRequest("invoice.txt", "Invoice 1042", { cookie }), undefined);

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toMatchObject({ filename: "invoice.txt", status: "queued" });
    const [stored] = await db.select().from(documents).where(eq(documents.id, body.id));
    expect(stored.uploadedBy).toBe(user.id);

    const queued = await db.select().from(jobs);
    expect(queued).toHaveLength(1);
    expect(queued[0]).toMatchObject({ queue: "extract-document", status: "queued", payload: { documentId: body.id } });
  });

  it("rejects unsupported content types, oversized files and missing files", async () => {
    const { cookie } = await createUser();

    const wrongType = await uploadDocument(uploadRequest("data.json", "{}", { cookie, type: "application/json" }), undefined);
    const tooLarge = await uploadDocument(uploadRequest("big.txt", "x".repeat(1_000_001), { cookie }), undefined);
    const missing = await uploadDocument(jsonRequest("POST", "/api/documents", {}, { cookie }), undefined);

    expect([wrongType.status, tooLarge.status, missing.status]).toEqual([415, 413, 400]);
  });

  it("stores the text layer of an uploaded PDF", async () => {
    const { cookie } = await createUser();
    const pdf = makePdf([["INVOICE INV-2042", "Vendor: Acme Supplies"], ["Total due: 1,250.00 USD"]]);

    const res = await uploadDocument(uploadRequest("invoice.pdf", pdf, { cookie, type: "application/pdf" }), undefined);

    expect(res.status).toBe(201);
    const [stored] = await db.select().from(documents).where(eq(documents.id, (await res.json()).id));
    expect(stored.mimeType).toBe("application/pdf");
    expect(stored.content).toContain("INV-2042");
    expect(stored.content).toContain("1,250.00 USD");
    expect(await db.select().from(jobs)).toHaveLength(1);
  });

  it("rejects PDFs that are fake, scanned or damaged without storing anything", async () => {
    const { cookie } = await createUser();
    const upload = (content: string | Uint8Array<ArrayBuffer>) =>
      uploadDocument(uploadRequest("doc.pdf", content, { cookie, type: "application/pdf" }), undefined);

    const fake = await upload("Invoice 1042");
    const scanned = await upload(makePdf([[]]));
    const damaged = await upload("%PDF-1.4 truncated");

    expect([fake.status, scanned.status, damaged.status]).toEqual([415, 422, 422]);
    expect(await db.select().from(documents)).toHaveLength(0);
  });
});

describe("document visibility", () => {
  it("shows uploaders only their own documents and reviewers everything", async () => {
    const alice = await createUser();
    const bob = await createUser();
    const reviewer = await createUser("reviewer");
    await insertDocument({ filename: "alice.txt", uploadedBy: alice.user.id });
    await insertDocument({ filename: "bob.txt", uploadedBy: bob.user.id });

    const names = async (cookie: string) => {
      const res = await listDocuments(jsonRequest("GET", "/api/documents", undefined, { cookie }), undefined);
      return (await res.json()).map((d: { filename: string }) => d.filename).sort();
    };

    expect(await names(alice.cookie)).toEqual(["alice.txt"]);
    expect(await names(reviewer.cookie)).toEqual(["alice.txt", "bob.txt"]);
  });

  it("returns 404 when an uploader requests another user's document", async () => {
    const alice = await createUser();
    const bob = await createUser();
    const doc = await insertDocument({ uploadedBy: bob.user.id });

    const res = await getDocument(
      jsonRequest("GET", `/api/documents/${doc.id}`, undefined, { cookie: alice.cookie }),
      routeParams(doc.id),
    );
    expect(res.status).toBe(404);
  });

  it("returns 400 for malformed ids", async () => {
    const { cookie } = await createUser();
    const res = await getDocument(jsonRequest("GET", "/api/documents/abc", undefined, { cookie }), routeParams("abc"));
    expect(res.status).toBe(400);
  });
});

describe("POST /api/documents/:id/extract", () => {
  const requestExtraction = (id: string, cookie: string) =>
    extractDocument(jsonRequest("POST", `/api/documents/${id}/extract`, undefined, { cookie }), routeParams(id));

  it("is restricted to reviewers", async () => {
    const { user, cookie } = await createUser();
    const doc = await insertDocument({ status: "failed", uploadedBy: user.id });

    expect((await requestExtraction(doc.id, cookie)).status).toBe(403);
  });

  it("re-queues a failed document", async () => {
    const { cookie } = await createUser("reviewer");
    const doc = await insertDocument({ status: "failed" });

    const res = await requestExtraction(doc.id, cookie);

    expect(res.status).toBe(202);
    expect(await statusOf(doc.id)).toBe("queued");
    expect(await db.select().from(jobs)).toHaveLength(1);
  });

  it.each(["queued", "processing", "approved", "rejected"] as const)(
    "refuses to queue a document that is %s",
    async (status) => {
      const { cookie } = await createUser("reviewer");
      const doc = await insertDocument({ status });

      expect((await requestExtraction(doc.id, cookie)).status).toBe(409);
      expect(await db.select().from(jobs)).toHaveLength(0);
    },
  );
});

describe("PATCH /api/documents/:id", () => {
  it("is restricted to reviewers", async () => {
    const { user, cookie } = await createUser();
    const doc = await insertDocument({ status: "extracted", extracted: FIELDS, uploadedBy: user.id });

    const res = await review(doc.id, { action: "approve" }, cookie);
    expect(res.status).toBe(403);
  });

  it("approves with reviewer corrections", async () => {
    const { cookie } = await createUser("reviewer");
    const doc = await insertDocument({ status: "extracted", extracted: FIELDS });
    const corrected = { ...FIELDS, totalAmount: 1300 };

    const res = await review(doc.id, { action: "approve", fields: corrected }, cookie);

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "approved", extracted: corrected });
  });

  it("rejects malformed review payloads", async () => {
    const { cookie } = await createUser("reviewer");
    const doc = await insertDocument({ status: "extracted", extracted: FIELDS });

    const res = await review(doc.id, { action: "maybe" }, cookie);
    expect(res.status).toBe(400);
  });

  it("lets exactly one of two concurrent reviews win", async () => {
    const first = await createUser("reviewer");
    const second = await createUser("reviewer");
    const doc = await insertDocument({ status: "extracted", extracted: FIELDS });

    const responses = await Promise.all([
      review(doc.id, { action: "approve" }, first.cookie),
      review(doc.id, { action: "reject" }, second.cookie),
    ]);

    expect(responses.map((r) => r.status).sort()).toEqual([200, 409]);
    const winner = await responses.find((r) => r.status === 200)!.json();
    expect(await statusOf(doc.id)).toBe(winner.status);
  });
});
