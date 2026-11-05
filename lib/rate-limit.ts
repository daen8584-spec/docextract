import { sql } from "drizzle-orm";
import { db } from "../db";
import { AppError } from "./errors";
import { currentLogger } from "./logger";

/** A token bucket: `capacity` requests at once, refilling continuously at `refillPerSecond`. */
export type Bucket = { capacity: number; refillPerSecond: number };

export const LIMITS = {
  /** Guessing one account's password: 5 attempts, then 1 per minute. */
  loginPerEmail: { capacity: 5, refillPerSecond: 1 / 60 },
  /** Trying many accounts from one address: 20 attempts, then 4 per minute. */
  loginPerIp: { capacity: 20, refillPerSecond: 1 / 15 },
  /** Mass account creation: 5 accounts, then 1 every 10 minutes. */
  signupPerIp: { capacity: 5, refillPerSecond: 1 / 600 },
  /** Uploads, each of which costs an LLM call: 20 at once, then 10 per minute. */
  uploadPerUser: { capacity: 20, refillPerSecond: 1 / 6 },
} satisfies Record<string, Bucket>;

/**
 * A bucket whose last update is older than this has refilled completely, which is the
 * same as having no row, so such rows can be deleted.
 */
export const IDLE_ROW_TTL_SECONDS = Math.ceil(
  Math.max(...Object.values(LIMITS).map((bucket) => bucket.capacity / bucket.refillPerSecond)),
);

type Check = readonly [key: string | null, bucket: Bucket];

/**
 * Takes one token from every bucket that applies (checks with a null key are skipped,
 * for example per-IP limits when the client address is unknown). Throws
 * TOO_MANY_REQUESTS with a Retry-After hint if any bucket is empty.
 *
 * Buckets live in PostgreSQL, so limits hold across every instance of the web app
 * and survive restarts. See docs/adr/0006-rate-limiting.md.
 */
export async function enforceRateLimits(checks: readonly Check[]): Promise<void> {
  let retryAfterMs = 0;
  for (const [key, bucket] of checks) {
    if (key === null) continue;
    const { rows } = await db.execute<{ allowed: boolean; retry_after_ms: number }>(
      sql`select allowed, retry_after_ms from rate_limit_take(${key}, ${bucket.capacity}, ${bucket.refillPerSecond})`,
    );
    const [result] = rows;
    if (!result.allowed) retryAfterMs = Math.max(retryAfterMs, result.retry_after_ms);
  }
  if (retryAfterMs > 0) {
    const retryAfterSeconds = Math.ceil(retryAfterMs / 1000);
    currentLogger().warn({ retryAfterSeconds }, "rate limit exceeded");
    throw new AppError("TOO_MANY_REQUESTS", "Too many requests. Try again later.", undefined, { retryAfterSeconds });
  }
}

/** Deletes buckets that have refilled completely. Returns the number of rows removed. */
export async function pruneRateLimits(): Promise<number> {
  const { rowCount } = await db.execute(
    sql`delete from rate_limits where updated_at < now() - make_interval(secs => ${IDLE_ROW_TTL_SECONDS})`,
  );
  return rowCount ?? 0;
}
