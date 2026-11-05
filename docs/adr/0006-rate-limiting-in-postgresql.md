# 0006. Rate limit with token buckets in PostgreSQL

- Status: Accepted
- Date: 2026-11-05

## Context

Login accepts unlimited password guesses, signup can create accounts in bulk, and every upload triggers a paid LLM call. Each needs a limit. The limit must hold across every instance of the web application, and survive restarts, otherwise it can be bypassed by spreading requests or waiting for a deploy. In-process counters meet neither requirement. Redis is the usual store for counters but would add infrastructure that the rest of the system does not need, as with the job queue in [0003](0003-postgresql-job-queue.md).

Two properties of the deployment also matter. Next.js route handlers do not expose the socket address, and the `X-Forwarded-For` header is written by the client unless a proxy appends to it, so the client address is only trustworthy behind a known number of proxies.

## Decision

- Use token buckets stored in a `rate_limits` table, one row per key. A bucket holds up to `capacity` tokens and refills continuously; each attempt takes one token. Unlike a fixed window, this allows a short burst but never twice the limit around a window boundary.
- Take tokens through a SQL function, `rate_limit_take`, that computes the refill and updates the row under a row lock. Concurrent attempts on one key are serialized by the lock: in a test of 40 concurrent attempts against a bucket of 10 tokens, exactly 10 succeeded.
- Apply these limits:
  - login per email address: 5 attempts, then 1 per minute
  - login per client address: 20 attempts, then 4 per minute
  - signup per client address: 5 accounts, then 1 every 10 minutes
  - upload per user: 20 uploads, then 10 per minute
- Count every login attempt, successful or not, so the limit does not reveal which addresses have accounts.
- Determine the client address only from the entry in `X-Forwarded-For` written by the outermost trusted proxy, configured with `TRUSTED_PROXY_HOPS`. Without it, per-address limits are skipped and per-account and per-user limits still apply.
- Reply `429 Too Many Requests` with a `Retry-After` header.
- The worker deletes buckets idle long enough to have refilled completely, which is equivalent to having no row, so the table stays small.

## Consequences

- Limits are consistent across instances and restarts with no new infrastructure.
- Each limited request performs one extra write per applicable bucket. That is negligible next to password hashing on login and the LLM call behind an upload, but would be significant for a high-volume read endpoint, where a cache-backed limiter would fit better.
- A per-email limit lets an attacker lock a known account out of password login for minutes at a time. That is the usual trade-off for brute-force protection; the limit is short and the account is not disabled.
