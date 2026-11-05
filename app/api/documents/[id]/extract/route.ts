import { NextResponse } from "next/server";
import { REVIEWER_ROLES, requireUser } from "@/lib/auth";
import { requestExtraction } from "@/lib/documents";
import { handle, parseDocumentId } from "@/lib/http";

type Context = { params: Promise<{ id: string }> };

/** Queues a new extraction attempt. Processing happens asynchronously in the worker. */
export const POST = handle(async (request: Request, { params }: Context) => {
  const user = await requireUser(request, REVIEWER_ROLES);
  const id = parseDocumentId((await params).id);
  return NextResponse.json(await requestExtraction(user, id), { status: 202 });
});
