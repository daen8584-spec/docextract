import { NextResponse } from "next/server";
import { z } from "zod";
import { createSession, registerUser } from "@/lib/auth";
import { handle, parseJson } from "@/lib/http";
import { setSessionCookie } from "@/lib/session-cookie";

const signupSchema = z.object({
  email: z.string().trim().toLowerCase().max(254).pipe(z.email()),
  name: z.string().trim().min(1).max(100),
  password: z.string().min(12, "Password must be at least 12 characters").max(128),
});

export const POST = handle(async (request: Request) => {
  const input = await parseJson(request, signupSchema);
  const user = await registerUser(input);
  const session = await createSession(user.id);
  return setSessionCookie(NextResponse.json(user, { status: 201 }), session);
});
