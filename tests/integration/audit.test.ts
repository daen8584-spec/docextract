import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { GET as listEvents } from "@/app/api/documents/[id]/events/route";
import { PATCH as reviewDocument } from "@/app/api/documents/[id]/route";
import { POST as uploadDocument } from "@/app/api/documents/route";
import { db } from "@/db";
import { documentEvents, documents } from "@/db/schema";
import { jsonRequest, routeParams, uploadRequest } from "./requests";
import { createUser } from "./users";

const FIELDS = { vendor: "Acme Supplies", invoiceNumber: "1042", totalAmount: 1250, currency: "USD", dueDate: "2026-12-01" };

async function insertExtracted(uploadedBy?: string) {
  const [doc] = await db
    .insert(documents)
    .values({ filename: "invoice.txt", mimeType: "text/plain", content: "Invoice", status: "extracted", extracted: FIELDS, uploadedBy })
    .returning();
  return doc;
}

const eventsOf = (documentId: string) =>
  db.select().from(documentEvents).where(eq(documentEvents.documentId, documentId)).orderBy(documentEvents.createdAt);

describe("audit log", () => {
  it("records the upload with its actor", async () => {
    const { user, cookie } = await createUser();

    const res = await uploadDocument(uploadRequest("invoice.txt", "Invoice 1042", { cookie }), undefined);
    const { id } = await res.json();

    const [event] = await eventsOf(id);
    expect(event).toMatchObject({ type: "uploaded", actorId: user.id, toStatus: "queued" });
  });

  it("records reviewer corrections as a field diff", async () => {
    const reviewer = await createUser("reviewer");
    const doc = await insertExtracted();

    await reviewDocument(
      jsonRequest("PATCH", `/api/documents/${doc.id}`, { action: "approve", fields: { ...FIELDS, totalAmount: 1300 } }, { cookie: reviewer.cookie }),
      routeParams(doc.id),
    );

    const [event] = await eventsOf(doc.id);
    expect(event).toMatchObject({
      type: "approved",
      actorId: reviewer.user.id,
      fromStatus: "extracted",
      toStatus: "approved",
      data: { corrections: [{ field: "totalAmount", from: 1250, to: 1300 }] },
    });
  });

  it("writes no event when a review is rejected as a conflict", async () => {
    const reviewer = await createUser("reviewer");
    const [doc] = await db
      .insert(documents)
      .values({ filename: "done.txt", mimeType: "text/plain", content: "x", status: "approved" })
      .returning();

    const res = await reviewDocument(
      jsonRequest("PATCH", `/api/documents/${doc.id}`, { action: "reject" }, { cookie: reviewer.cookie }),
      routeParams(doc.id),
    );

    expect(res.status).toBe(409);
    expect(await eventsOf(doc.id)).toEqual([]);
  });

  it("applies document visibility rules to the event history", async () => {
    const owner = await createUser();
    const stranger = await createUser();
    const doc = await insertExtracted(owner.user.id);
    const request = (cookie: string) =>
      listEvents(jsonRequest("GET", `/api/documents/${doc.id}/events`, undefined, { cookie }), routeParams(doc.id));

    expect((await request(owner.cookie)).status).toBe(200);
    expect((await request(stranger.cookie)).status).toBe(404);
  });
});
