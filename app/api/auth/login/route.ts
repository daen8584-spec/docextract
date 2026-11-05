import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticate, createSession } from "@/lib/auth";
import { AppError } from "@/lib/errors";
import { handle, parseJson } from "@/lib/http";
import { setSessionCookie } from "@/lib/session-cookie";

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().max(254),
  password: z.string().min(1).max(128),
});

export const POST = handle(async (request: Request) => {
  const { email, password } = await parseJson(request, loginSchema);
  const user = await authenticate(email, password);
  if (!user) throw new AppError("UNAUTHENTICATED", "Invalid email or password");

  const session = await createSession(user.id);
  return setSessionCookie(NextResponse.json(user), session);
});
