import { randomUUID } from "node:crypto";
import { db } from "@/db";
import { users, type UserRole } from "@/db/schema";
import { createSession } from "@/lib/auth";
import { SESSION_COOKIE } from "@/lib/cookies";
import { hashPassword } from "@/lib/password";

export const TEST_PASSWORD = "correct horse battery staple";

let passwordHash: Promise<string> | undefined;

/** Creates a user with a live session and returns the Cookie header for it. */
export async function createUser(role: UserRole = "uploader") {
  passwordHash ??= hashPassword(TEST_PASSWORD);
  const [user] = await db
    .insert(users)
    .values({ email: `${role}-${randomUUID()}@example.test`, name: `Test ${role}`, role, passwordHash: await passwordHash })
    .returning();
  const session = await createSession(user.id);
  return { user, cookie: `${SESSION_COOKIE}=${session.token}` };
}

export function sessionCookieFrom(response: Response): string {
  const header = response.headers.get("set-cookie") ?? "";
  const match = header.match(new RegExp(`${SESSION_COOKIE}=([^;]*)`));
  if (!match) throw new Error("Response did not set a session cookie");
  return `${SESSION_COOKIE}=${match[1]}`;
}
