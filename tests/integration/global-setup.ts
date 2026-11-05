import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";

/**
 * Applies all migrations to the test database once per test run.
 * Each test file then truncates tables in `setup.ts` for isolation.
 */
export default async function setup() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is not set");

  const db = drizzle(url);
  try {
    await migrate(db, { migrationsFolder: "db/migrations" });
  } finally {
    await db.$client.end();
  }
}
