import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticate, createSession } from "@/lib/auth";
import { clientIp } from "@/lib/client-ip";
import { AppError } from "@/lib/errors";
import { handle, parseJson } from "@/lib/http";
import { enforceRateLimits, LIMITS } from "@/lib/rate-limit";
import { setSessionCookie } from "@/lib/session-cookie";

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().max(254),
  password: z.string().min(1).max(128),
});

export const POST = handle(async (request: Request) => {
  const { email, password } = await parseJson(request, loginSchema);
  // Every attempt counts, whether or not it succeeds, so the limit cannot be used to
  // tell which email addresses have accounts.
  const ip = clientIp(request);
  await enforceRateLimits([
    [`login:email:${email}`, LIMITS.loginPerEmail],
    [ip && `login:ip:${ip}`, LIMITS.loginPerIp],
  ]);
  const user = await authenticate(email, password);
  if (!user) throw new AppError("UNAUTHENTICATED", "Invalid email or password");

  const session = await createSession(user.id);
  return setSessionCookie(NextResponse.json(user), session);
});
