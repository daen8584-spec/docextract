export type ErrorCode =
  | "BAD_REQUEST"
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "PAYLOAD_TOO_LARGE"
  | "UNSUPPORTED_MEDIA_TYPE"
  | "TOO_MANY_REQUESTS"
  | "BAD_GATEWAY";

const HTTP_STATUS: Record<ErrorCode, number> = {
  BAD_REQUEST: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  PAYLOAD_TOO_LARGE: 413,
  UNSUPPORTED_MEDIA_TYPE: 415,
  TOO_MANY_REQUESTS: 429,
  BAD_GATEWAY: 502,
};

/**
 * An expected failure with a stable code. Route handlers translate it into an
 * HTTP response; anything that is not an AppError is treated as a server error.
 */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly details?: unknown;
  /** Sent as the Retry-After header, in seconds. */
  readonly retryAfterSeconds?: number;

  constructor(code: ErrorCode, message: string, details?: unknown, options: { retryAfterSeconds?: number } = {}) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.details = details;
    this.retryAfterSeconds = options.retryAfterSeconds;
  }

  get status(): number {
    return HTTP_STATUS[this.code];
  }
}

/** True when a database error (or any error in its cause chain) is a unique violation. */
export function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error;
  while (current !== null && typeof current === "object") {
    if ((current as { code?: unknown }).code === "23505") return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}
