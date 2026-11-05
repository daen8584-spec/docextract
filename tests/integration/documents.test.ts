import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST as extractDocument } from "@/app/api/documents/[id]/extract/route";
import { GET as getDocument, PATCH as reviewDocument } from "@/app/api/documents/[id]/route";
import { GET as listDocuments, POST as uploadDocument } from "@/app/api/documents/route";
import { db } from "@/db";
import { documents } from "@/db/schema";
import { extractInvoiceFields, type InvoiceFields } from "@/lib/extract";
import { jsonRequest, routeParams, uploadRequest } from "./requests";

vi.mock("@/lib/extract", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/extract")>();
  return { ...actual, extractInvoiceFields: vi.fn() };
});

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

beforeEach(() => {
  vi.mocked(extractInvoiceFields).mockReset();
});

describe("POST /api/documents", () => {
  it("stores a valid text upload as pending", async () => {
    const res = await uploadDocument(uploadRequest("invoice.txt", "Invoice 1042"));

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toMatchObject({ filename: "invoice.txt", status: "pending" });
    expect(await statusOf(body.id)).toBe("pending");
  });

  it("rejects unsupported content types", async () => {
    const res = await uploadDocument(uploadRequest("data.json", "{}", { type: "application/json" }));
    expect(res.status).toBe(415);
  });

  it("rejects files larger than 1 MB", async () => {
    const res = await uploadDocument(uploadRequest("big.txt", "x".repeat(1_000_001)));
    expect(res.status).toBe(413);
  });

  it("rejects requests without a file", async () => {
    const res = await uploadDocument(jsonRequest("POST", "/api/documents", {}));
    expect(res.status).toBe(400);
  });
});

describe("GET /api/documents", () => {
  it("lists documents newest first", async () => {
    await insertDocument({ filename: "older.txt", createdAt: new Date("2026-01-01T00:00:00Z") });
    await insertDocument({ filename: "newer.txt", createdAt: new Date("2026-02-01T00:00:00Z") });

    const res = await listDocuments();
    const body = await res.json();

    expect(body.map((d: { filename: string }) => d.filename)).toEqual(["newer.txt", "older.txt"]);
  });
});

describe("POST /api/documents/:id/extract", () => {
  it("stores validated fields and marks the document extracted", async () => {
    vi.mocked(extractInvoiceFields).mockResolvedValue(FIELDS);
    const doc = await insertDocument();

    const res = await extractDocument(jsonRequest("POST", `/api/documents/${doc.id}/extract`), routeParams(doc.id));

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "extracted", extracted: FIELDS });
  });

  it("refuses to re-extract a reviewed document", async () => {
    const doc = await insertDocument({ status: "approved", extracted: FIELDS });

    const res = await extractDocument(jsonRequest("POST", `/api/documents/${doc.id}/extract`), routeParams(doc.id));

    expect(res.status).toBe(409);
    expect(extractInvoiceFields).not.toHaveBeenCalled();
  });
});

describe("PATCH /api/documents/:id", () => {
  it("approves with reviewer corrections", async () => {
    const doc = await insertDocument({ status: "extracted", extracted: FIELDS });
    const corrected = { ...FIELDS, totalAmount: 1300 };

    const res = await reviewDocument(
      jsonRequest("PATCH", `/api/documents/${doc.id}`, { action: "approve", fields: corrected }),
      routeParams(doc.id),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "approved", extracted: corrected });
  });

  it("rejects malformed review payloads", async () => {
    const doc = await insertDocument({ status: "extracted", extracted: FIELDS });

    const res = await reviewDocument(
      jsonRequest("PATCH", `/api/documents/${doc.id}`, { action: "maybe" }),
      routeParams(doc.id),
    );

    expect(res.status).toBe(400);
  });

  it("returns 404 for unknown documents and 400 for malformed ids", async () => {
    const unknown = "00000000-0000-4000-8000-000000000000";
    const missing = await getDocument(jsonRequest("GET", `/api/documents/${unknown}`), routeParams(unknown));
    const malformed = await getDocument(jsonRequest("GET", "/api/documents/abc"), routeParams("abc"));

    expect(missing.status).toBe(404);
    expect(malformed.status).toBe(400);
  });

  it("lets exactly one of two concurrent reviews win", async () => {
    const doc = await insertDocument({ status: "extracted", extracted: FIELDS });
    const review = (action: "approve" | "reject") =>
      reviewDocument(jsonRequest("PATCH", `/api/documents/${doc.id}`, { action }), routeParams(doc.id));

    const responses = await Promise.all([review("approve"), review("reject")]);
    const statuses = responses.map((r) => r.status).sort();

    expect(statuses).toEqual([200, 409]);
    const winner = await responses.find((r) => r.status === 200)!.json();
    expect(await statusOf(doc.id)).toBe(winner.status);
  });
});
