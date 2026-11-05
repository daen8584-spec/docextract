import { sql } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { POST as login } from "@/app/api/auth/login/route";
import { POST as signup } from "@/app/api/auth/signup/route";
import { POST as uploadDocument } from "@/app/api/documents/route";
import { db } from "@/db";
import { rateLimits } from "@/db/schema";
import { LIMITS, pruneRateLimits } from "@/lib/rate-limit";
import { jsonRequest, uploadRequest } from "./requests";
import { createUser, TEST_PASSWORD } from "./users";

const attemptLogin = (email: string, password: string, headers?: Record<string, string>) =>
  login(jsonRequest("POST", "/api/auth/login", { email, password }, { headers }), undefined);

/** Moves every bucket's last update into the past, as if that much time had elapsed. */
const elapse = (seconds: number) =>
  db.execute(sql`update rate_limits set updated_at = updated_at - make_interval(secs => ${seconds})`);

afterEach(() => {
  delete process.env.TRUSTED_PROXY_HOPS;
});

describe("login rate limiting", () => {
  it("blocks repeated attempts on one account and tells the client when to retry", async () => {
    const { user } = await createUser();
    for (let i = 0; i < LIMITS.loginPerEmail.capacity; i++) {
      expect((await attemptLogin(user.email, "wrong password")).status).toBe(401);
    }

    // Even the correct password is refused while the account is limited.
    const blocked = await attemptLogin(user.email, TEST_PASSWORD);
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(Number(blocked.headers.get("retry-after"))).toBeLessThanOrEqual(60);

    // Other accounts are unaffected.
    const other = await createUser();
    expect((await attemptLogin(other.user.email, TEST_PASSWORD)).status).toBe(200);
  });

  it("allows attempts again after the bucket refills", async () => {
    const { user } = await createUser();
    for (let i = 0; i <= LIMITS.loginPerEmail.capacity; i++) await attemptLogin(user.email, "wrong password");
    expect((await attemptLogin(user.email, TEST_PASSWORD)).status).toBe(429);

    await elapse(61);
    expect((await attemptLogin(user.email, TEST_PASSWORD)).status).toBe(200);
  });

  it("limits attempts across many accounts from one address behind a trusted proxy", async () => {
    process.env.TRUSTED_PROXY_HOPS = "1";
    const from = (ip: string) => ({ "x-forwarded-for": ip });
    for (let i = 0; i < LIMITS.loginPerIp.capacity; i++) {
      expect((await attemptLogin(`user${i}@example.test`, "guess", from("203.0.113.7"))).status).toBe(401);
    }
    expect((await attemptLogin("another@example.test", "guess", from("203.0.113.7"))).status).toBe(429);
    // A spoofed prefix does not change the address the proxy recorded.
    expect((await attemptLogin("another@example.test", "guess", from("198.51.100.1, 203.0.113.7"))).status).toBe(429);
    expect((await attemptLogin("another@example.test", "guess", from("198.51.100.1"))).status).toBe(401);
  });
});

describe("signup and upload rate limiting", () => {
  it("limits account creation per address", async () => {
    process.env.TRUSTED_PROXY_HOPS = "1";
    const attempt = (i: number) =>
      signup(
        jsonRequest(
          "POST",
          "/api/auth/signup",
          { email: `new${i}@example.test`, name: "New", password: TEST_PASSWORD },
          { headers: { "x-forwarded-for": "203.0.113.9" } },
        ),
        undefined,
      );
    for (let i = 0; i < LIMITS.signupPerIp.capacity; i++) expect((await attempt(i)).status).toBe(201);
    expect((await attempt(99)).status).toBe(429);
  });

  it("limits uploads per user", async () => {
    const { cookie } = await createUser();
    const upload = () => uploadDocument(uploadRequest("invoice.txt", "Invoice 1042", { cookie }), undefined);
    for (let i = 0; i < LIMITS.uploadPerUser.capacity; i++) expect((await upload()).status).toBe(201);

    const blocked = await upload();
    expect(blocked.status).toBe(429);
    expect(await blocked.json()).toEqual({ error: "Too many requests. Try again later." });
  });
});

describe("pruneRateLimits", () => {
  it("removes only buckets that have refilled completely", async () => {
    const { user } = await createUser();
    await attemptLogin(user.email, TEST_PASSWORD);
    await attemptLogin("someone@example.test", "guess");
    await db.execute(sql`update rate_limits set updated_at = now() - interval '2 days' where key = ${`login:email:${user.email}`}`);

    expect(await pruneRateLimits()).toBe(1);
    const remaining = await db.select({ key: rateLimits.key }).from(rateLimits);
    expect(remaining).toEqual([{ key: "login:email:someone@example.test" }]);
  });
});
