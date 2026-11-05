import { sql } from "drizzle-orm";
import { afterAll, beforeEach } from "vitest";
import { db } from "@/db";

beforeEach(async () => {
  await db.execute(sql`truncate table documents, sessions, users restart identity cascade`);
});

afterAll(async () => {
  await db.$client.end();
});
