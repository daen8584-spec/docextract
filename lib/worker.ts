import { setTimeout as sleep } from "node:timers/promises";
import { claimJob, completeJob, failJob, type Job, recoverStaleJobs } from "./queue";
import { logger, withLogger } from "./logger";

export type QueueHandler = {
  /** Processes one job. Throwing marks the attempt as failed and schedules a retry. */
  run(job: Job): Promise<void>;
  /** Called once when a job has failed its final attempt. */
  onExhausted?(job: Job, error: string): Promise<void>;
};

export type WorkerOptions = {
  handlers: Record<string, QueueHandler>;
  workerId: string;
  signal: AbortSignal;
  pollIntervalMs?: number;
  recoveryIntervalMs?: number;
};

export const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** Claims and processes at most one job. Returns false when the queue had nothing due. */
export async function processNext(queue: string, handler: QueueHandler, workerId: string): Promise<boolean> {
  const job = await claimJob(queue, workerId);
  if (!job) return false;

  const log = logger.child({ jobId: job.id, queue, attempt: job.attempts, maxAttempts: job.maxAttempts });
  await withLogger(log, async () => {
    const startedAt = performance.now();
    const durationMs = () => Math.round(performance.now() - startedAt);
    try {
      await handler.run(job);
      await completeJob(job.id);
      log.info({ durationMs: durationMs() }, "job succeeded");
    } catch (error) {
      const message = errorMessage(error);
      const status = await failJob(job.id, message);
      log.warn({ err: error, status, durationMs: durationMs() }, "job attempt failed");
      if (status === "failed") await handler.onExhausted?.(job, message);
    }
  });
  return true;
}

async function recover(handlers: WorkerOptions["handlers"]) {
  for (const job of await recoverStaleJobs()) {
    logger.warn({ jobId: job.id, queue: job.queue, status: job.status }, "recovered stale job");
    if (job.status === "failed") await handlers[job.queue]?.onExhausted?.(job, "Worker lock expired");
  }
}

/**
 * Polls every queue until the signal aborts. A job in progress always
 * finishes before shutdown, so stopping the worker never abandons a lock.
 */
export async function runWorker(options: WorkerOptions): Promise<void> {
  const { handlers, workerId, signal, pollIntervalMs = 1000, recoveryIntervalMs = 60_000 } = options;
  let nextRecovery = 0;
  logger.info({ workerId, queues: Object.keys(handlers) }, "worker started");

  while (!signal.aborted) {
    let processed = false;
    try {
      if (Date.now() >= nextRecovery) {
        await recover(handlers);
        nextRecovery = Date.now() + recoveryIntervalMs;
      }
      for (const [queue, handler] of Object.entries(handlers)) {
        if (signal.aborted) break;
        processed = (await processNext(queue, handler, workerId)) || processed;
      }
    } catch (error) {
      logger.error({ err: error }, "worker loop error");
    }
    if (!processed && !signal.aborted) {
      await sleep(pollIntervalMs, undefined, { signal }).catch(() => undefined);
    }
  }
  logger.info({ workerId }, "worker stopped");
}
