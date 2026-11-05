# 0004. Server-side sessions with scrypt password hashing

- Status: Accepted
- Date: 2026-11-05

## Context

The application needs authenticated users with three roles (uploader, reviewer, admin) and object-level authorization, where uploaders may only access their own documents. Sessions must be revocable, for example on logout or role changes. The authentication surface is small: email and password sign-up and login.

## Decision

Implement server-side sessions using only the Node.js standard library:

- Passwords are hashed with scrypt (N=32768, r=8, p=1, 16-byte random salt). Parameters are stored with each hash so they can be raised later without invalidating existing passwords. Comparison uses `timingSafeEqual`.
- Login performs a password verification even when the email is unknown, so response time does not reveal which emails are registered. Both failure cases return the same error.
- Session tokens are 32 random bytes. Only their SHA-256 hash is stored, so a database leak does not expose usable sessions.
- The token travels in an `HttpOnly`, `SameSite=Lax` cookie, marked `Secure` in production, and sessions expire after seven days.
- Authorization is enforced in every API route and server component. Uploaders requesting another user's document receive `404` rather than `403`, so document ids cannot be probed.
- A lightweight `proxy.ts` redirects requests without a session cookie to the login page. It is a convenience only and never the authorization boundary.

A third-party authentication library was considered. For this scope it would add a large dependency and its own schema while providing features (OAuth providers, multi-factor flows) that are not required.

## Consequences

- The full authentication path is a few hundred lines that can be read in one sitting and is covered by integration tests.
- Sessions can be revoked instantly by deleting rows.
- Every authenticated request performs one indexed database lookup.
- Additional factors, OAuth or rate limiting on login would need to be built or would justify adopting a dedicated library. Rate limiting is listed on the roadmap.
