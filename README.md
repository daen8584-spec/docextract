# DocExtract

[![CI](https://github.com/daen8584-spec/docextract/actions/workflows/ci.yml/badge.svg)](https://github.com/daen8584-spec/docextract/actions/workflows/ci.yml)

Upload a document (text or PDF), extract structured fields with an LLM in the background, then have a reviewer verify, correct and approve the result before it is trusted.

DocExtract treats model output as untrusted input. Every response is validated against a schema, extraction runs on a retrying job queue, every state change is recorded in an audit log, and extraction quality is measured with an evaluation harness.

## Features

- **Background extraction** on a PostgreSQL-backed job queue with retries, exponential backoff, deduplication and crash recovery
- **Schema-validated LLM output** with any OpenAI-compatible provider (Groq, OpenRouter, LiteLLM, a local llama.cpp server)
- **Human review** with field-level corrections and atomic, race-free status transitions
- **Authentication and authorization** with server-side sessions, three roles and object-level access control
- **Rate limiting** of login, signup and upload with token buckets in PostgreSQL, consistent across instances
- **PDF support** through the PDF.js text layer, with clear errors for scanned, damaged and oversized files
- **Audit log** of every state change, including who changed what and the reviewer's corrections
- **Evaluation harness** reporting per-field accuracy, missing values and hallucinations across a test dataset
- **Observability** through structured JSON logs, request ids, and LLM latency and token usage per extraction
- **Tested** with unit tests and with integration tests that run the API route handlers and the worker against a real PostgreSQL database in CI

## Architecture

```mermaid
flowchart LR
  U[Uploader] -->|upload| API[Next.js route handlers]
  R[Reviewer] -->|review| API
  API -->|document + event + job, one transaction| DB[(PostgreSQL)]
  W[Worker] -->|claim job: FOR UPDATE SKIP LOCKED| DB
  W -->|chat completion, JSON mode| LLM[OpenAI-compatible LLM]
  LLM --> V{Zod validation}
  V -->|valid| W
  V -->|invalid: retry with backoff| W
  W -->|fields + event| DB
```

The web application and the worker are separate processes that share only the database. Uploading a document inserts the document, its audit event and its extraction job in a single transaction, so a document can never exist without the job that processes it.

Each document moves through this lifecycle:

```mermaid
stateDiagram-v2
  [*] --> queued: upload
  queued --> processing: worker claims job
  processing --> extracted: valid output
  processing --> queued: attempt failed, retry scheduled
  processing --> failed: attempts exhausted
  failed --> queued: reviewer retries
  extracted --> queued: reviewer re-runs extraction
  extracted --> approved: approve, optionally with corrections
  extracted --> rejected: reject
  approved --> [*]
  rejected --> [*]
```

## Design decisions

Significant decisions are documented as [Architecture Decision Records](docs/adr/README.md):

- [0002](docs/adr/0002-drizzle-orm.md) Drizzle ORM for typed queries, SQL migrations and raw SQL where needed
- [0003](docs/adr/0003-postgresql-job-queue.md) A job queue in PostgreSQL for transactional enqueueing without extra infrastructure
- [0004](docs/adr/0004-session-authentication.md) Server-side sessions with scrypt hashing and hashed session tokens
- [0005](docs/adr/0005-untrusted-llm-output.md) Validation, human review and evaluation for LLM output
- [0006](docs/adr/0006-rate-limiting-in-postgresql.md) Token bucket rate limiting in PostgreSQL
- [0007](docs/adr/0007-pdf-text-extraction.md) PDF text extraction at upload time

## Roles

| Role | Upload | View documents | Run extraction | Approve or reject |
| --- | --- | --- | --- | --- |
| `uploader` | Yes | Own documents only | No | No |
| `reviewer` | Yes | All | Yes | Yes |
| `admin` | Yes | All | Yes | Yes |

New accounts are uploaders. Promote a user with `npm run user:role -- user@example.com reviewer`. The `admin` role currently has the same permissions as `reviewer` and is reserved for future administrative features.

## API

Document endpoints and `/api/auth/me` require a session cookie. Errors are returned as `{"error": "...", "details": ...}` with an `x-request-id` header for correlation with the logs.

Login, signup and upload are rate limited (see [0006](docs/adr/0006-rate-limiting-in-postgresql.md)) and answer `429` with a `Retry-After` header when a limit is reached. Per-address limits need the client address: set `TRUSTED_PROXY_HOPS` to the number of proxies in front of the application that append to `X-Forwarded-For`. Without it, only the per-account and per-user limits apply.

| Method | Path | Access | Description |
| --- | --- | --- | --- |
| `POST` | `/api/auth/signup` | Public | Create an uploader account (password of at least 12 characters) and start a session |
| `POST` | `/api/auth/login` | Public | Start a session |
| `POST` | `/api/auth/logout` | Public | End the current session, if any, and clear the cookie |
| `GET` | `/api/auth/me` | Authenticated | Current user |
| `POST` | `/api/documents` | Authenticated | Upload a document (`multipart/form-data`, field `file`): UTF-8 text up to 1 MB or a PDF with a text layer up to 10 MB and 50 pages. A larger request body is refused with `413` before it is read into memory. Queues extraction |
| `GET` | `/api/documents` | Authenticated | List up to 50 visible documents, newest first |
| `GET` | `/api/documents/:id` | Authenticated | Document with its extracted fields |
| `GET` | `/api/documents/:id/events` | Authenticated | Audit history of the document |
| `POST` | `/api/documents/:id/extract` | Reviewer | Queue a new extraction attempt (`202 Accepted`) |
| `PATCH` | `/api/documents/:id` | Reviewer | `{"action":"approve","fields":{...}}` or `{"action":"reject"}` |

## Running locally

Requirements: Node.js 22 or later, PostgreSQL 15 or later, and an API key for any OpenAI-compatible provider.

```bash
git clone https://github.com/daen8584-spec/docextract.git
cd docextract
npm install
cp .env.example .env
```

Edit `.env`: set `DATABASE_URL` to your PostgreSQL connection string and `LLM_BASE_URL`, `LLM_API_KEY` and `LLM_MODEL` to your provider. Then create the database and apply the migrations:

```bash
createdb docextract
npm run db:migrate
```

Start the web application and the worker in separate terminals:

```bash
npm run dev
npm run worker
```

Open http://localhost:3000, create an account, promote it with `npm run user:role -- <email> reviewer`, and upload `eval/cases/01-simple.txt`.

### With Docker

```bash
export LLM_API_KEY=...   # or put LLM_BASE_URL, LLM_API_KEY and LLM_MODEL in .env
docker compose up -d --build
```

This starts PostgreSQL, applies the migrations, and runs the web app on `http://localhost:3000` and the extraction worker, all from one image. The app runs in production mode with secure cookies, which browsers accept on `localhost` but require HTTPS for elsewhere. Promote a user with `docker compose exec web node_modules/.bin/tsx scripts/set-role.ts <email> reviewer`. CI builds the image, runs the migrations and checks the running app on every push.

## Testing

```bash
npm run test:unit
createdb docextract_test
npm run test:integration
```

The integration tests use `TEST_DATABASE_URL`, which defaults to `DATABASE_URL` with the database name changed to `docextract_test`. They refuse to run against the same database as `DATABASE_URL`, because they truncate every table.

Unit tests cover the extraction client, scoring, field diffing, PDF text extraction and client address resolution with no external dependencies. Integration tests call the route handlers and the worker against a real PostgreSQL database and cover authentication, authorization, rate limits and their refill (including 40 concurrent attempts on one bucket), upload size and encoding checks, PDF uploads, the audit log, concurrent reviews, queue semantics (deduplication, concurrent claims, backoff, crash recovery) and the extraction retry flow. The LLM is mocked in all tests. CI runs lint, type checking, both test suites and a production build on every push.

## Evaluating extraction quality

```bash
npm run eval
npm run eval -- --min-accuracy 0.95
```

The harness runs every case in `eval/cases` through the extraction pipeline and reports exact-match rate and per-field accuracy, separating incorrect values, missing values and hallucinated values. The dataset has 20 cases in two groups. Cases 01 to 10 cover common layouts: line items with tax, European and Chilean number formats, written-out dates, currency symbols, receipts without invoice numbers and distracting reference numbers. Cases 11 to 20 target specific failure modes: the customer named before the vendor, partially paid invoices, OCR noise, a second currency given for reference, US and Indian date conventions, a dollar sign that means Canadian dollars, Indian and Swiss digit grouping, an email thread quoting an older invoice, and a document with no currency, where the correct answer is null rather than a guess. With `--min-accuracy` the command exits non-zero when field accuracy falls below the threshold, so it can gate prompt or model changes. Full results for each run are written to `eval/results/`, which is not committed.

Reviewed documents can be turned into new cases:

```bash
npm run eval:export
```

This exports approved documents whose fields the reviewer corrected, using the approved values as ground truth. Add `-- --all` to export every approved document. Exported files contain real document content and should be reviewed before they are committed.

### Results

Measured on 2026-11-05 through the Groq API, across all 20 cases:

| Model | Exact match | Field accuracy | Hallucinated values | Latency p50 | Latency p95 | Tokens per document |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `openai/gpt-oss-20b` | 100% | 100% | 0 | 577 ms | 1,000 ms | 438 (mean) |

The model extracted every field correctly, including the ten failure-mode cases. The dataset is synthetic and every case has a single unambiguous answer, so a perfect score shows that the pipeline handles these layouts. It does not establish accuracy on real documents. The dataset's main role is regression testing: a prompt, model or provider change should not lower this score. Accuracy on real documents is measured through reviewer corrections, which `npm run eval:export` turns into additional cases. Latency is measured at the client and includes the network round trip.

## Observability

Logs are structured JSON on stdout. Every API request logs its method, path, status and duration under a request id, which is also returned in the `x-request-id` response header. Worker logs carry the job id and attempt number. Each successful extraction records the model, latency and token usage in the audit log.

## Project structure

```
app/            Next.js pages and API route handlers
components/     React components
db/             Schema and SQL migrations
docs/adr/       Architecture Decision Records
eval/cases/     Evaluation dataset
lib/            Domain logic: auth, documents, extraction, queue, worker, evaluation
scripts/        Command-line tools (roles, evaluation)
tests/          Integration tests
worker/         Background worker entry point
```

## Roadmap

- OCR for scanned PDFs
- Confidence scores and highlighting of uncertain fields
- `LISTEN/NOTIFY` to start jobs without polling delay

## License

[MIT](LICENSE)
