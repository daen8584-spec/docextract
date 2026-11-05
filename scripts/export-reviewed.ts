import "./load-env";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { and, eq, sql } from "drizzle-orm";
import { db } from "../db";
import { documentEvents, documents } from "../db/schema";

/**
 * Turns reviewed documents into evaluation cases. The approved fields are the
 * reviewer-verified ground truth. By default only documents where the reviewer
 * corrected the model are exported, since those are the cases the model got wrong.
 *
 * Exported files contain real document content: review them before committing.
 */
const CASES_DIR = "eval/cases";

const { values: args } = parseArgs({ options: { all: { type: "boolean", default: false } } });

async function main() {
  const corrected = sql`exists (
    select 1 from ${documentEvents}
    where ${documentEvents.documentId} = ${documents.id}
      and ${documentEvents.type} = 'approved'
      and ${documentEvents.data} ? 'corrections'
  )`;

  const rows = await db
    .select({ id: documents.id, content: documents.content, extracted: documents.extracted })
    .from(documents)
    .where(and(eq(documents.status, "approved"), args.all ? undefined : corrected));

  await mkdir(CASES_DIR, { recursive: true });
  for (const row of rows) {
    const base = path.join(CASES_DIR, `reviewed-${row.id.slice(0, 8)}`);
    await writeFile(`${base}.txt`, row.content);
    await writeFile(`${base}.expected.json`, `${JSON.stringify(row.extracted, null, 2)}\n`);
  }
  console.log(`Exported ${rows.length} reviewed document(s) to ${CASES_DIR}`);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => db.$client.end());
