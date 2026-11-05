import "../scripts/load-env";
import { hostname } from "node:os";
import { db } from "../db";
import { EXTRACTION_QUEUE, extractionHandler } from "../lib/extraction-job";
import { logger } from "../lib/logger";
import { runWorker } from "../lib/worker";

const controller = new AbortController();

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    logger.info({ signal }, "shutdown requested, finishing current job");
    controller.abort();
  });
}

runWorker({
  handlers: { [EXTRACTION_QUEUE]: extractionHandler },
  workerId: `${hostname()}:${process.pid}`,
  signal: controller.signal,
})
  .catch((error) => {
    logger.fatal({ err: error }, "worker crashed");
    process.exitCode = 1;
  })
  .finally(() => db.$client.end());
