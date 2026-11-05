import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { createDocument, listDocuments } from "@/lib/documents";
import { AppError } from "@/lib/errors";
import { handle } from "@/lib/http";
import { enforceRateLimits, LIMITS } from "@/lib/rate-limit";

export const POST = handle(async (request: Request) => {
  const user = await requireUser(request);
  await enforceRateLimits([[`upload:user:${user.id}`, LIMITS.uploadPerUser]]);
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) {
    throw new AppError("BAD_REQUEST", "Expected multipart field 'file'");
  }

  return NextResponse.json(await createDocument(user, file), { status: 201 });
});

export const GET = handle(async (request: Request) => {
  const user = await requireUser(request);
  return NextResponse.json(await listDocuments(user));
});
