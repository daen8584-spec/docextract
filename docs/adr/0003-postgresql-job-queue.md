# 0003. Run extraction on a PostgreSQL-backed job queue

- Status: Accepted
- Date: 2026-11-05

## Context

LLM calls take seconds, fail intermittently (rate limits, timeouts, malformed output) and should not hold an HTTP request open. Extraction must therefore run in the background with retries. Two properties matter most:

1. A document must never exist without the job that will process it, and a job must never refer to a document that was rolled back.
2. Several workers must be able to run concurrently without processing the same job twice.

Dedicated brokers such as Redis-based queues or RabbitMQ satisfy the second property but not the first, because enqueueing happens outside the database transaction. They also add infrastructure to operate.

## Decision

Implement a small job queue in PostgreSQL (`jobs` table, `lib/queue.ts`):

- Jobs are inserted in the same transaction as the change that requires them, so enqueueing is atomic with the upload or re-extraction request.
- Workers claim jobs with `UPDATE ... WHERE id = (SELECT ... FOR UPDATE SKIP LOCKED LIMIT 1)`, so concurrent workers each take a different row and never block one another.
- A failed attempt is rescheduled with exponential backoff (2 s, 4 s, 8 s, capped at 5 minutes) until `max_attempts` is reached, after which the job is marked `failed` and the handler's `onExhausted` hook records the outcome on the document.
- A partial unique index on `(queue, dedupe_key) WHERE status IN ('queued', 'running')` guarantees at most one active job per document.
- Jobs whose worker died while holding them are detected by lock age and returned to the queue.
- Workers finish the job in progress before shutting down on `SIGINT` or `SIGTERM`.

## Consequences

- No additional infrastructure: the queue is backed up, monitored and migrated with the rest of the data.
- Job state can be inspected and repaired with SQL.
- Polling adds up to one second of latency before a job starts. `LISTEN/NOTIFY` can remove this if needed.
- Throughput is bounded by PostgreSQL write capacity. That is several orders of magnitude above this workload. A dedicated broker becomes worthwhile only at a scale this system does not target.
