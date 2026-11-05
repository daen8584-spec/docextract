import "./load-env";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { type CaseResult, type EvalSummary, failedCase, scoreCase, summarize } from "../lib/eval";
import { extractInvoice, invoiceFields } from "../lib/extract";
import { FIELD_KEYS, FIELD_LABELS } from "../lib/fields";

const CASES_DIR = "eval/cases";
const RESULTS_DIR = "eval/results";

const { values: args } = parseArgs({
  options: {
    "min-accuracy": { type: "string" },
    filter: { type: "string" },
  },
});

const percent = (value: number) => `${(value * 100).toFixed(1)}%`;

async function loadCases() {
  const files = (await readdir(CASES_DIR)).filter((f) => f.endsWith(".txt")).sort();
  const selected = args.filter ? files.filter((f) => f.includes(args.filter!)) : files;

  return Promise.all(
    selected.map(async (file) => {
      const id = file.replace(/\.txt$/, "");
      const content = await readFile(path.join(CASES_DIR, file), "utf8");
      const raw = JSON.parse(await readFile(path.join(CASES_DIR, `${id}.expected.json`), "utf8"));
      const expected = invoiceFields.safeParse(raw);
      if (!expected.success) throw new Error(`Invalid expected fields in ${id}.expected.json`);
      return { id, content, expected: expected.data };
    }),
  );
}

function report(model: string, summary: EvalSummary, results: CaseResult[]): string {
  const lines = [
    `Model: ${model}`,
    `Cases: ${summary.cases}   Exact match: ${percent(summary.exactMatchRate)}   ` +
      `Field accuracy: ${percent(summary.fieldAccuracy)}   Extraction errors: ${summary.errors}`,
    "",
    "| Field | Accuracy | Incorrect | Missing | Spurious |",
    "| --- | ---: | ---: | ---: | ---: |",
    ...FIELD_KEYS.map((field) => {
      const f = summary.fields[field];
      return `| ${FIELD_LABELS[field]} | ${percent(f.accuracy)} | ${f.incorrect} | ${f.missing} | ${f.spurious} |`;
    }),
  ];

  const failures = results.filter((r) => !r.exactMatch);
  if (failures.length > 0) {
    lines.push("", "Cases with mismatches:");
    for (const result of failures) {
      const wrong = FIELD_KEYS.filter((f) => result.outcomes[f] !== "correct")
        .map((f) => `${f} (${result.outcomes[f]})`)
        .join(", ");
      lines.push(`- ${result.id}: ${result.error ?? wrong}`);
    }
  }
  return lines.join("\n");
}

async function main() {
  const cases = await loadCases();
  if (cases.length === 0) throw new Error(`No cases found in ${CASES_DIR}`);

  const results: CaseResult[] = [];
  let model = process.env.LLM_MODEL ?? "unknown";

  // Sequential on purpose: keeps provider rate limits and latency figures predictable.
  for (const testCase of cases) {
    try {
      const extraction = await extractInvoice(testCase.content);
      model = extraction.model;
      results.push(scoreCase(testCase.id, testCase.expected, extraction.fields));
    } catch (error) {
      results.push(failedCase(testCase.id, error instanceof Error ? error.message : String(error)));
    }
  }

  const summary = summarize(results);
  console.log(report(model, summary, results));

  await mkdir(RESULTS_DIR, { recursive: true });
  const output = path.join(RESULTS_DIR, `${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  await writeFile(output, JSON.stringify({ model, summary, results }, null, 2));
  console.log(`\nFull results written to ${output}`);

  const threshold = args["min-accuracy"] === undefined ? undefined : Number(args["min-accuracy"]);
  if (threshold !== undefined && summary.fieldAccuracy < threshold) {
    console.error(`Field accuracy ${percent(summary.fieldAccuracy)} is below the threshold of ${percent(threshold)}`);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
