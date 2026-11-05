import { NextResponse } from "next/server";
import { REVIEWER_ROLES, requireUser } from "@/lib/auth";
import { getDocument, reviewDocument, reviewSchema } from "@/lib/documents";
import { handle, parseDocumentId, parseJson } from "@/lib/http";

type Context = { params: Promise<{ id: string }> };

export const GET = handle(async (request: Request, { params }: Context) => {
  const user = await requireUser(request);
  const id = parseDocumentId((await params).id);
  return NextResponse.json(await getDocument(user, id));
});

export const PATCH = handle(async (request: Request, { params }: Context) => {
  await requireUser(request, REVIEWER_ROLES);
  const id = parseDocumentId((await params).id);
  const review = await parseJson(request, reviewSchema);
  return NextResponse.json(await reviewDocument(id, review));
});
