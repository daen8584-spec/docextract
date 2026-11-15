/**
 * Measures how faithfully OCR recovers the text of the evaluation cases from scans.
 *
 * Each case is rendered as a scanned PDF (an image-only PDF at the given scan resolution)
 * and read back with the OCR pipeline the worker uses. The script reports the character
 * error rate against the original text, the cases recovered exactly, the mean word
 * confidence and the OCR time per page. It needs no LLM: it measures the step OCR adds
 * in front of extraction.
 *
 *     npm run eval:ocr
 *
 * Cases with non-ASCII characters are skipped, because the test PDF generator writes
 * ASCII only.
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { ocrPdf, ocrSettings } from "../lib/ocr";
import { makeScannedPdf } from "../tests/fixtures/pdf";

const CASES_DIR = "eval/cases";
const SCAN_RESOLUTIONS = [150, 300];

/** Collapses runs of spaces and blank lines, which carry no meaning for extraction. */
const normalize = (text: string) =>
  text
    .split("\n")
    .map((line) => line.trim().replace(/\s+/g, " "))
    .filter(Boolean)
    .join("\n");

function editDistance(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    previous = current;
  }
  return previous[b.length];
}

async function main() {
  const files = (await readdir(CASES_DIR)).filter((name) => name.endsWith(".txt")).sort();
  const cases: { name: string; text: string }[] = [];
  const skipped: string[] = [];
  for (const file of files) {
    const text = await readFile(path.join(CASES_DIR, file), "utf8");
    if (/[^\x20-\x7e\n]/.test(text)) skipped.push(file.replace(/\.txt$/, ""));
    else cases.push({ name: file.replace(/\.txt$/, ""), text });
  }
  const settings = ocrSettings();
  console.log(
    `${cases.length} cases (skipped, non-ASCII: ${skipped.join(", ") || "none"}); ` +
      `OCR renders pages at ${settings.dpi} dpi with Tesseract (${settings.language}, page segmentation mode ${settings.pageSegmentation})\n`,
  );
  console.log("| Scan resolution | Character error rate | Cases recovered exactly | Mean word confidence | OCR time per page |");
  console.log("| ---: | ---: | ---: | ---: | ---: |");
  for (const resolution of SCAN_RESOLUTIONS) {
    let errors = 0;
    let characters = 0;
    let exact = 0;
    let confidence = 0;
    let milliseconds = 0;
    const misses: string[] = [];
    for (const { name, text } of cases) {
      const reference = normalize(text);
      const scan = makeScannedPdf([text.split("\n")], resolution);
      const started = performance.now();
      const result = await ocrPdf(scan, settings);
      milliseconds += performance.now() - started;
      const recovered = normalize(result.text);
      const distance = editDistance(recovered, reference);
      errors += distance;
      characters += reference.length;
      confidence += result.meanConfidence;
      if (distance === 0) exact += 1;
      else misses.push(`${name} (${distance})`);
    }
    console.log(
      `| ${resolution} dpi | ${((100 * errors) / characters).toFixed(2)}% | ${exact} of ${cases.length} | ` +
        `${(confidence / cases.length).toFixed(1)} | ${Math.round(milliseconds / cases.length)} ms |`,
    );
    if (misses.length) console.error(`  ${resolution} dpi, cases with differences (edit distance): ${misses.join(", ")}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
