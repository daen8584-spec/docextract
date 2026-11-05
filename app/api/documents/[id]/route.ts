import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { documents } from "@/db/schema";
import { invoiceFields } from "@/lib/extract";

type Context = { params: Promise<{ id: string }> };

const idSchema = z.uuid();

const reviewSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("approve"), fields: invoiceFields.optional() }),
  z.object({ action: z.literal("reject") }),
]);

const invalidId = () => NextResponse.json({ error: "Invalid document id" }, { status: 400 });
const notFound = () => NextResponse.json({ error: "Document not found" }, { status: 404 });

export async function GET(_request: Request, { params }: Context) {
  const { id } = await params;
  if (!idSchema.safeParse(id).success) return invalidId();

  const [doc] = await db.select().from(documents).where(eq(documents.id, id)).limit(1);
  return doc ? NextResponse.json(doc) : notFound();
}

export async function PATCH(request: Request, { params }: Context) {
  const { id } = await params;
  if (!idSchema.safeParse(id).success) return invalidId();

  const parsed = reviewSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid review payload", issues: parsed.error.issues }, { status: 400 });
  }
  const review = parsed.data;

  const changes =
    review.action === "approve"
      ? { status: "approved" as const, ...(review.fields && { extracted: review.fields }) }
      : { status: "rejected" as const };

  const [updated] = await db
    .update(documents)
    .set(changes)
    .where(and(eq(documents.id, id), eq(documents.status, "extracted")))
    .returning({ id: documents.id, status: documents.status, extracted: documents.extracted });

  if (updated) return NextResponse.json(updated);

  const [existing] = await db.select({ status: documents.status }).from(documents).where(eq(documents.id, id)).limit(1);
  if (!existing) return notFound();
  return NextResponse.json({ error: `Cannot review a document with status '${existing.status}'` }, { status: 409 });
}
