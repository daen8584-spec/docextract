import { AsyncLocalStorage } from "node:async_hooks";
import pino, { type Logger } from "pino";

export type { Logger };

/** Structured JSON logs to stdout. Secrets are redacted before serialization. */
export const logger: Logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  base: { service: "docextract" },
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: {
    paths: ["password", "*.password", "headers.cookie", "headers.authorization", "apiKey"],
    censor: "[redacted]",
  },
});

const context = new AsyncLocalStorage<Logger>();

/** Runs `fn` with a scoped logger (for example one carrying a request or job id). */
export function withLogger<T>(scoped: Logger, fn: () => T): T {
  return context.run(scoped, fn);
}

/** The logger for the current request or job, or the root logger outside of one. */
export function currentLogger(): Logger {
  return context.getStore() ?? logger;
}
