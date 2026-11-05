import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { POST as login } from "@/app/api/auth/login/route";
import { POST as logout } from "@/app/api/auth/logout/route";
import { GET as me } from "@/app/api/auth/me/route";
import { POST as signup } from "@/app/api/auth/signup/route";
import { db } from "@/db";
import { sessions } from "@/db/schema";
import { jsonRequest } from "./requests";
import { createUser, sessionCookieFrom, TEST_PASSWORD } from "./users";

const signupBody = { email: "Ada@Example.test", name: "Ada", password: TEST_PASSWORD };

describe("POST /api/auth/signup", () => {
  it("creates an uploader and starts a session with a secure cookie", async () => {
    const res = await signup(jsonRequest("POST", "/api/auth/signup", signupBody), undefined);

    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ email: "ada@example.test", name: "Ada", role: "uploader" });

    const cookie = res.headers.get("set-cookie") ?? "";
    expect(cookie).toMatch(/docextract_session=/);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=lax/i);
  });

  it("rejects a duplicate email regardless of case", async () => {
    await signup(jsonRequest("POST", "/api/auth/signup", signupBody), undefined);
    const res = await signup(
      jsonRequest("POST", "/api/auth/signup", { ...signupBody, email: "ADA@example.test" }),
      undefined,
    );
    expect(res.status).toBe(409);
  });

  it("rejects short passwords", async () => {
    const res = await signup(
      jsonRequest("POST", "/api/auth/signup", { ...signupBody, password: "short" }),
      undefined,
    );
    expect(res.status).toBe(400);
  });
});

describe("POST /api/auth/login", () => {
  it("returns the same 401 for a wrong password and an unknown email", async () => {
    const { user } = await createUser();

    const wrongPassword = await login(
      jsonRequest("POST", "/api/auth/login", { email: user.email, password: "not the password" }),
      undefined,
    );
    const unknownEmail = await login(
      jsonRequest("POST", "/api/auth/login", { email: "nobody@example.test", password: TEST_PASSWORD }),
      undefined,
    );

    expect(wrongPassword.status).toBe(401);
    expect(unknownEmail.status).toBe(401);
    expect(await wrongPassword.json()).toEqual(await unknownEmail.json());
  });

  it("starts a session that authenticates later requests", async () => {
    const { user } = await createUser("reviewer");

    const res = await login(
      jsonRequest("POST", "/api/auth/login", { email: user.email, password: TEST_PASSWORD }),
      undefined,
    );
    expect(res.status).toBe(200);

    const session = await me(jsonRequest("GET", "/api/auth/me", undefined, { cookie: sessionCookieFrom(res) }), undefined);
    expect(await session.json()).toMatchObject({ id: user.id, role: "reviewer" });
  });
});

describe("sessions", () => {
  it("requires a session", async () => {
    const res = await me(jsonRequest("GET", "/api/auth/me"), undefined);
    expect(res.status).toBe(401);
  });

  it("invalidates the session on logout", async () => {
    const { cookie } = await createUser();

    const res = await logout(jsonRequest("POST", "/api/auth/logout", undefined, { cookie }), undefined);
    expect(res.status).toBe(204);

    const after = await me(jsonRequest("GET", "/api/auth/me", undefined, { cookie }), undefined);
    expect(after.status).toBe(401);
  });

  it("rejects expired sessions", async () => {
    const { user, cookie } = await createUser();
    await db.update(sessions).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(sessions.userId, user.id));

    const res = await me(jsonRequest("GET", "/api/auth/me", undefined, { cookie }), undefined);
    expect(res.status).toBe(401);
  });

  it("stores only a hash of the session token", async () => {
    const { user, cookie } = await createUser();
    const token = cookie.split("=")[1];
    const [stored] = await db.select().from(sessions).where(eq(sessions.userId, user.id));

    expect(stored.id).not.toBe(token);
    expect(stored.id).toMatch(/^[0-9a-f]{64}$/);
  });
});
