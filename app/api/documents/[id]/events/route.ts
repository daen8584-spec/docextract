import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { listDocumentEvents } from "@/lib/documents";
import { handle, parseDocumentId } from "@/lib/http";

type Context = { params: Promise<{ id: string }> };

export const GET = handle(async (request: Request, { params }: Context) => {
  const user = await requireUser(request);
  const id = parseDocumentId((await params).id);
  return NextResponse.json(await listDocumentEvents(user, id));
});
