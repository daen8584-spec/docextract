import { createHash, randomBytes } from "node:crypto";
import { and, eq, lt } from "drizzle-orm";
import { db } from "../db";
import { sessions, userRole, users } from "../db/schema";
import { readCookie, SESSION_COOKIE } from "./cookies";
import { AppError, isUniqueViolation } from "./errors";
import { hashPassword, verifyPassword } from "./password";

export type Role = (typeof userRole.enumValues)[number];
export type SessionUser = { id: string; email: string; name: string; role: Role };
export type Session = { token: string; expiresAt: Date };

export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const REVIEWER_ROLES: readonly Role[] = ["reviewer", "admin"];

/**
 * Hash of a random password that is never used. Verifying against it when an
 * email is unknown keeps login timing the same for existing and unknown users.
 */
const DUMMY_PASSWORD_HASH =
  "scrypt$32768$8$1$Qgb+I+M98gPHsKZOuvFSCQ==$eTVFfRpuHyy1aIJBaeF+7zFQ0ZjIDf/7Pcr8CEXFQAWkaXFnzvto0R8kRR9UOXzZFUGlk+/awDSD5n02XtSD/Q==";

const userColumns = { id: users.id, email: users.email, name: users.name, role: users.role };

/** Session tokens are stored only as SHA-256 hashes, so a database leak does not expose live sessions. */
const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

export const isReviewer = (user: SessionUser) => REVIEWER_ROLES.includes(user.role);

export async function registerUser(input: { email: string; name: string; password: string }): Promise<SessionUser> {
  const passwordHash = await hashPassword(input.password);
  try {
    const [user] = await db
      .insert(users)
      .values({ email: input.email, name: input.name, passwordHash })
      .returning(userColumns);
    return user;
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new AppError("CONFLICT", "An account with this email already exists");
    }
    throw error;
  }
}

export async function authenticate(email: string, password: string): Promise<SessionUser | null> {
  const [user] = await db
    .select({ ...userColumns, passwordHash: users.passwordHash })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  if (!user) {
    await verifyPassword(password, DUMMY_PASSWORD_HASH);
    return null;
  }
  if (!(await verifyPassword(password, user.passwordHash))) return null;

  return { id: user.id, email: user.email, name: user.name, role: user.role };
}

export async function createSession(userId: string): Promise<Session> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

  await db.delete(sessions).where(and(eq(sessions.userId, userId), lt(sessions.expiresAt, new Date())));
  await db.insert(sessions).values({ id: hashToken(token), userId, expiresAt });

  return { token, expiresAt };
}

export async function validateSessionToken(token: string): Promise<SessionUser | null> {
  const id = hashToken(token);
  const [row] = await db
    .select({ ...userColumns, expiresAt: sessions.expiresAt })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(eq(sessions.id, id))
    .limit(1);

  if (!row) return null;
  if (row.expiresAt.getTime() <= Date.now()) {
    await db.delete(sessions).where(eq(sessions.id, id));
    return null;
  }
  return { id: row.id, email: row.email, name: row.name, role: row.role };
}

export async function invalidateSession(token: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.id, hashToken(token)));
}

export const readSessionToken = (request: Request) => readCookie(request.headers.get("cookie"), SESSION_COOKIE);

/**
 * Resolves the authenticated user for an API request.
 * Throws 401 without a valid session and 403 when the role is not allowed.
 */
export async function requireUser(request: Request, roles?: readonly Role[]): Promise<SessionUser> {
  const token = readSessionToken(request);
  const user = token ? await validateSessionToken(token) : null;

  if (!user) throw new AppError("UNAUTHENTICATED", "Authentication required");
  if (roles && !roles.includes(user.role)) throw new AppError("FORBIDDEN", "Insufficient permissions");
  return user;
}
