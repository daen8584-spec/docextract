import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { AppError } from "./errors";
import { logger, withLogger } from "./logger";

type RouteHandler<C> = (request: Request, context: C) => Promise<Response>;

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._-]{1,128}$/;

export function errorResponse(error: AppError): NextResponse {
  const body = error.details === undefined ? { error: error.message } : { error: error.message, details: error.details };
  const response = NextResponse.json(body, { status: error.status });
  if (error.retryAfterSeconds !== undefined) response.headers.set("retry-after", String(error.retryAfterSeconds));
  return response;
}

/** Accepts a caller-supplied request id only if it is safe to log; otherwise generates one. */
function requestIdFor(request: Request): string {
  const supplied = request.headers.get("x-request-id");
  return supplied && REQUEST_ID_PATTERN.test(supplied) ? supplied : randomUUID();
}

/**
 * Wraps a route handler with request-scoped logging and error mapping:
 * - every request gets an id, returned in the `x-request-id` header
 * - AppErrors become JSON error responses with their status code
 * - unexpected errors are logged and returned as a generic 500
 * - one structured log line per request with status and duration
 */
export function handle<C>(handler: RouteHandler<C>): RouteHandler<C> {
  return async (request, context) => {
    const requestId = requestIdFor(request);
    const startedAt = performance.now();
    const log = logger.child({ requestId, method: request.method, path: new URL(request.url).pathname });

    let response: Response;
    try {
      response = await withLogger(log, () => handler(request, context));
    } catch (error) {
      if (error instanceof AppError) {
        response = errorResponse(error);
      } else {
        log.error({ err: error }, "unhandled error");
        response = NextResponse.json({ error: "Internal server error", requestId }, { status: 500 });
      }
    }

    response.headers.set("x-request-id", requestId);
    log.info({ status: response.status, durationMs: Math.round(performance.now() - startedAt) }, "request completed");
    return response;
  };
}

/**
 * Reads a multipart form body of at most maxBytes. The size is checked against
 * Content-Length before anything is read, and counted while reading for chunked
 * requests, so an oversized upload is refused without holding it in memory.
 */
export async function readFormData(request: Request, maxBytes: number): Promise<FormData | null> {
  const tooLarge = () => new AppError("PAYLOAD_TOO_LARGE", `Request body exceeds ${Math.floor(maxBytes / 1_000_000)} MB`);
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) throw tooLarge();
  if (!request.body) return null;

  const chunks: Uint8Array[] = [];
  let received = 0;
  const reader = request.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > maxBytes) {
      await reader.cancel();
      throw tooLarge();
    }
    chunks.push(value);
  }
  const body = new Blob(chunks as BlobPart[]);
  const contentType = request.headers.get("content-type") ?? "";
  return new Response(body, { headers: { "content-type": contentType } }).formData().catch(() => null);
}

export async function parseJson<T>(request: Request, schema: z.ZodType<T>): Promise<T> {
  const body: unknown = await request.json().catch(() => undefined);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new AppError("BAD_REQUEST", "Invalid request body", parsed.error.issues);
  }
  return parsed.data;
}

export function parseDocumentId(id: string): string {
  if (!z.uuid().safeParse(id).success) {
    throw new AppError("BAD_REQUEST", "Invalid document id");
  }
  return id;
}
