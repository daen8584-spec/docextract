import { desc } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { documents } from "@/db/schema";

const MAX_BYTES = 1_000_000;
const ALLOWED_TYPES = new Set(["text/plain"]);

const summary = {
  id: documents.id,
  filename: documents.filename,
  status: documents.status,
  createdAt: documents.createdAt,
};

export async function POST(request: Request) {
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Expected multipart field 'file'" }, { status: 400 });
  }
  if (!ALLOWED_TYPES.has(file.type)) {
    return NextResponse.json({ error: `Unsupported type: ${file.type || "unknown"}` }, { status: 415 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "File exceeds 1 MB" }, { status: 413 });
  }

  const [doc] = await db
    .insert(documents)
    .values({ filename: file.name, mimeType: file.type, content: await file.text() })
    .returning(summary);

  return NextResponse.json(doc, { status: 201 });
}

export async function GET() {
  const rows = await db.select(summary).from(documents).orderBy(desc(documents.createdAt)).limit(50);
  return NextResponse.json(rows);
}
