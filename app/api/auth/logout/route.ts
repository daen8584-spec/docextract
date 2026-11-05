import { NextResponse } from "next/server";
import { invalidateSession, readSessionToken } from "@/lib/auth";
import { handle } from "@/lib/http";
import { clearSessionCookie } from "@/lib/session-cookie";

export const POST = handle(async (request: Request) => {
  const token = readSessionToken(request);
  if (token) await invalidateSession(token);
  return clearSessionCookie(new NextResponse(null, { status: 204 }));
});
