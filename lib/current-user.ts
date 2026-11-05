import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { type SessionUser, validateSessionToken } from "./auth";
import { SESSION_COOKIE } from "./cookies";

/** Session lookup for server components, which read cookies through next/headers. */
export async function getCurrentUser(): Promise<SessionUser | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return token ? validateSessionToken(token) : null;
}

export async function requirePageUser(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}
