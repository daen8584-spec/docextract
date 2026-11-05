import { NextResponse } from "next/server";
import { REVIEWER_ROLES, requireUser } from "@/lib/auth";
import { extractDocument } from "@/lib/documents";
import { handle, parseDocumentId } from "@/lib/http";

type Context = { params: Promise<{ id: string }> };

export const POST = handle(async (request: Request, { params }: Context) => {
  const user = await requireUser(request, REVIEWER_ROLES);
  const id = parseDocumentId((await params).id);
  return NextResponse.json(await extractDocument(user, id));
});
