import { sql } from "drizzle-orm";
import { db } from "../db";
import type { JobStatus } from "../db/schema";

/** Anything that can run SQL: the database or an open transaction. */
export type Executor = Pick<typeof db, "execute">;

export type Job = {
  id: string;
  queue: string;
  payload: unknown;
  /** Attempts made so far, including the current one. */
  attempts: number;
  maxAttempts: number;
};

export const QUEUE_DEFAULTS = {
  maxAttempts: 5,
  backoffBaseSeconds: 2,
  backoffMaxSeconds: 300,
  lockTimeoutSeconds: 300,
} as const;

type JobRow = { id: string; queue: string; payload: unknown; attempts: number; max_attempts: number };

const toJob = (row: JobRow): Job => ({
  id: row.id,
  queue: row.queue,
  payload: row.payload,
  attempts: row.attempts,
  maxAttempts: row.max_attempts,
});

/**
 * Adds a job. Pass an executor that is a transaction to enqueue atomically with
 * the change that triggered it. With a dedupe key, at most one job per key can
 * be queued or running; a duplicate returns null instead of a new job id.
 */
export async function enqueue(
  executor: Executor,
  queue: string,
  payload: unknown,
  options: { dedupeKey?: string; maxAttempts?: number } = {},
): Promise<string | null> {
  const { rows } = await executor.execute<{ id: string }>(sql`
    insert into jobs (queue, payload, dedupe_key, max_attempts)
    values (${queue}, ${JSON.stringify(payload)}::jsonb, ${options.dedupeKey ?? null},
            ${options.maxAttempts ?? QUEUE_DEFAULTS.maxAttempts})
    on conflict (queue, dedupe_key) where status in ('queued', 'running') do nothing
    returning id`);
  return rows[0]?.id ?? null;
}

/**
 * Claims the next due job. SKIP LOCKED lets concurrent workers each take a
 * different row instead of blocking on, or double-processing, the same one.
 */
export async function claimJob(queue: string, workerId: string): Promise<Job | null> {
  const { rows } = await db.execute<JobRow>(sql`
    update jobs
    set status = 'running', attempts = attempts + 1, locked_at = now(), locked_by = ${workerId}, updated_at = now()
    where id = (
      select id from jobs
      where queue = ${queue} and status = 'queued' and run_at <= now()
      order by run_at
      limit 1
      for update skip locked
    )
    returning id, queue, payload, attempts, max_attempts`);
  return rows[0] ? toJob(rows[0]) : null;
}

/**
 * Marks a running job as done. Pass a transaction to complete it atomically with the
 * job's own writes; completing an already completed job does nothing.
 */
export async function completeJob(id: string, executor: Executor = db): Promise<void> {
  await executor.execute(sql`
    update jobs set status = 'succeeded', locked_at = null, locked_by = null, last_error = null, updated_at = now()
    where id = ${id} and status = 'running'`);
}

/**
 * Records a failed attempt. The job is retried with exponential backoff
 * (2s, 4s, 8s, ... capped at 5 minutes) until it runs out of attempts.
 */
export async function failJob(id: string, error: string): Promise<JobStatus | null> {
  const { backoffBaseSeconds, backoffMaxSeconds } = QUEUE_DEFAULTS;
  const { rows } = await db.execute<{ status: JobStatus }>(sql`
    update jobs set
      status = case when attempts >= max_attempts then 'failed'::job_status else 'queued'::job_status end,
      run_at = case when attempts >= max_attempts then run_at
               else now() + make_interval(secs => least(${backoffMaxSeconds}::float8,
                                                        ${backoffBaseSeconds}::float8 * power(2, attempts - 1)))
               end,
      last_error = ${error.slice(0, 2000)},
      locked_at = null,
      locked_by = null,
      updated_at = now()
    where id = ${id} and status = 'running'
    returning status`);
  return rows[0]?.status ?? null;
}

/**
 * Recovers jobs whose worker died mid-run (lock older than the timeout).
 * They are retried, or marked failed if they have no attempts left.
 */
export async function recoverStaleJobs(
  timeoutSeconds: number = QUEUE_DEFAULTS.lockTimeoutSeconds,
): Promise<(Job & { status: JobStatus })[]> {
  const { rows } = await db.execute<JobRow & { status: JobStatus }>(sql`
    update jobs set
      status = case when attempts >= max_attempts then 'failed'::job_status else 'queued'::job_status end,
      run_at = now(),
      last_error = 'Worker lock expired',
      locked_at = null,
      locked_by = null,
      updated_at = now()
    where status = 'running' and locked_at < now() - make_interval(secs => ${timeoutSeconds}::float8)
    returning id, queue, payload, attempts, max_attempts, status`);
  return rows.map((row) => ({ ...toJob(row), status: row.status }));
}
