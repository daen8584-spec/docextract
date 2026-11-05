import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { documents } from "@/db/schema";
import { ExtractionError, extractInvoiceFields } from "@/lib/extract";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) {
    return NextResponse.json({ error: "Invalid document id" }, { status: 400 });
  }

  const [doc] = await db.select().from(documents).where(eq(documents.id, id)).limit(1);
  if (!doc) {
    return NextResponse.json({ error: "Document not found" }, { status: 404 });
  }
  if (doc.status === "approved" || doc.status === "rejected") {
    return NextResponse.json({ error: `Document already ${doc.status}` }, { status: 409 });
  }

  let fields;
  try {
    fields = await extractInvoiceFields(doc.content);
  } catch (err) {
    if (err instanceof ExtractionError) {
      return NextResponse.json({ error: err.message }, { status: 502 });
    }
    throw err;
  }

  const [updated] = await db
    .update(documents)
    .set({ status: "extracted", extracted: fields })
    .where(eq(documents.id, id))
    .returning({ id: documents.id, status: documents.status, extracted: documents.extracted });

  return NextResponse.json(updated);
}
