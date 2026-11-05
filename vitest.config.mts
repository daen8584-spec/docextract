import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = path.dirname(fileURLToPath(import.meta.url));

try {
  process.loadEnvFile(path.join(root, ".env"));
} catch (error) {
  // CI provides variables directly instead of a .env file.
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
}

/** Defaults to DATABASE_URL with the database renamed to docextract_test. */
function testDatabaseUrl(): string {
  if (process.env.TEST_DATABASE_URL) return process.env.TEST_DATABASE_URL;
  if (!process.env.DATABASE_URL) return "postgresql://localhost:5432/docextract_test";
  const url = new URL(process.env.DATABASE_URL);
  url.pathname = "/docextract_test";
  return url.toString();
}

const TEST_DATABASE_URL = testDatabaseUrl();
if (TEST_DATABASE_URL === process.env.DATABASE_URL) {
  throw new Error("TEST_DATABASE_URL must differ from DATABASE_URL: integration tests truncate every table");
}
process.env.TEST_DATABASE_URL = TEST_DATABASE_URL;

export default defineConfig({
  resolve: {
    alias: { "@": root },
  },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          environment: "node",
          include: ["lib/**/*.test.ts"],
          env: { LOG_LEVEL: "silent" },
        },
      },
      {
        extends: true,
        test: {
          name: "integration",
          environment: "node",
          include: ["tests/integration/**/*.test.ts"],
          globalSetup: ["tests/integration/global-setup.ts"],
          setupFiles: ["tests/integration/setup.ts"],
          fileParallelism: false,
          env: {
            DATABASE_URL: TEST_DATABASE_URL,
            LOG_LEVEL: "silent",
          },
        },
      },
    ],
  },
});
