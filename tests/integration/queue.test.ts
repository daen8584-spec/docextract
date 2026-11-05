import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "@/db";
import { jobs } from "@/db/schema";
import { claimJob, completeJob, enqueue, failJob, recoverStaleJobs } from "@/lib/queue";

const QUEUE = "test-queue";

const jobById = async (id: string) => (await db.select().from(jobs).where(eq(jobs.id, id)))[0];

describe("job queue", () => {
  it("deduplicates active jobs by key and allows a new job once the previous one finished", async () => {
    const first = await enqueue(db, QUEUE, { n: 1 }, { dedupeKey: "doc-1" });
    const duplicate = await enqueue(db, QUEUE, { n: 2 }, { dedupeKey: "doc-1" });
    expect(first).not.toBeNull();
    expect(duplicate).toBeNull();

    const job = await claimJob(QUEUE, "worker-a");
    await completeJob(job!.id);

    expect(await enqueue(db, QUEUE, { n: 3 }, { dedupeKey: "doc-1" })).not.toBeNull();
  });

  it("enqueues atomically with the surrounding transaction", async () => {
    await expect(
      db.transaction(async (tx) => {
        await enqueue(tx, QUEUE, { n: 1 });
        throw new Error("rollback");
      }),
    ).rejects.toThrow("rollback");

    expect(await db.select().from(jobs)).toHaveLength(0);
  });

  it("gives concurrent workers different jobs", async () => {
    await enqueue(db, QUEUE, { n: 1 });
    await enqueue(db, QUEUE, { n: 2 });

    const claimed = await Promise.all([claimJob(QUEUE, "a"), claimJob(QUEUE, "b"), claimJob(QUEUE, "c")]);
    const ids = claimed.filter((job) => job !== null).map((job) => job.id);

    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
  });

  it("retries a failed attempt later with backoff", async () => {
    const id = (await enqueue(db, QUEUE, {}, { maxAttempts: 3 }))!;
    await claimJob(QUEUE, "a");

    expect(await failJob(id, "timeout")).toBe("queued");

    const job = await jobById(id);
    expect(job).toMatchObject({ status: "queued", attempts: 1, lastError: "timeout", lockedBy: null });
    expect(job.runAt.getTime()).toBeGreaterThan(Date.now());
    expect(await claimJob(QUEUE, "a")).toBeNull();
  });

  it("marks a job failed after its final attempt", async () => {
    const id = (await enqueue(db, QUEUE, {}, { maxAttempts: 1 }))!;
    await claimJob(QUEUE, "a");

    expect(await failJob(id, "bad output")).toBe("failed");
    expect((await jobById(id)).status).toBe("failed");
  });

  it("recovers jobs whose worker stopped holding the lock", async () => {
    const id = (await enqueue(db, QUEUE, {}))!;
    await claimJob(QUEUE, "crashed-worker");
    await db.execute(sql`update jobs set locked_at = now() - interval '10 minutes' where id = ${id}`);

    const recovered = await recoverStaleJobs(300);

    expect(recovered.map((job) => job.id)).toEqual([id]);
    expect(await jobById(id)).toMatchObject({ status: "queued", lockedBy: null });
  });
});
