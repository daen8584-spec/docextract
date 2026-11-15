import { execFile } from "node:child_process";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

/**
 * OCR settings. OCR is off unless OCR_ENABLED=true, because it needs Tesseract and
 * pdftoppm (poppler-utils) installed next to the app; the container image has both.
 */
export function ocrSettings() {
  return {
    enabled: process.env.OCR_ENABLED === "true",
    maxPages: Number(process.env.OCR_MAX_PAGES ?? 10),
    dpi: Number(process.env.OCR_DPI ?? 300),
    pageTimeoutMs: Number(process.env.OCR_PAGE_TIMEOUT_MS ?? 60_000),
    minConfidence: Number(process.env.OCR_MIN_CONFIDENCE ?? 60),
    language: process.env.OCR_LANGUAGE ?? "eng",
    // Tesseract page segmentation mode; see docs/adr/0008 for how the default was chosen.
    pageSegmentation: process.env.OCR_PSM ?? "6",
  };
}

export class OcrError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OcrError";
  }
}

export type OcrResult = {
  text: string;
  pages: number;
  /** Mean Tesseract word confidence, 0 to 100, over every recognized word. */
  meanConfidence: number;
  words: number;
};

/** Sums the word confidences in Tesseract TSV output. Rows with confidence -1 are layout, not words. */
export function wordConfidences(tsv: string): { total: number; words: number } {
  let total = 0;
  let words = 0;
  for (const line of tsv.split("\n").slice(1)) {
    const columns = line.split("\t");
    if (columns.length < 12) continue;
    const confidence = Number(columns[10]);
    if (confidence < 0 || columns[11].trim() === "") continue;
    total += confidence;
    words += 1;
  }
  return { total, words };
}

// Tesseract reads straight quotes as typographic ones, which would change values such as
// the Swiss amount 12'463.93.
const normalize = (text: string) =>
  text
    .replace(/[\u2018\u2019\u201b\u2032]/g, "'")
    .replace(/[\u201c\u201d\u2033]/g, '"')
    .replace(/\f/g, "\n")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

async function tool(command: string, args: string[], timeout: number): Promise<void> {
  try {
    await run(command, args, { timeout, maxBuffer: 16 * 1024 * 1024 });
  } catch (error) {
    const failure = error as NodeJS.ErrnoException & { killed?: boolean; stderr?: string };
    if (failure.code === "ENOENT") throw new OcrError(`${command} is not installed; OCR needs tesseract and pdftoppm`);
    if (failure.killed) throw new OcrError(`${command} took longer than ${timeout} ms`);
    throw new OcrError(`${command} failed: ${(failure.stderr ?? failure.message).trim().slice(0, 300)}`);
  }
}

/**
 * Renders each page of a PDF to a grayscale image with pdftoppm and reads it with
 * Tesseract. Every page is bounded by a timeout, and only the first `maxPages` pages
 * are read; uploads with more pages are rejected before they reach the worker.
 */
export async function ocrPdf(bytes: Uint8Array, settings = ocrSettings()): Promise<OcrResult> {
  const directory = await mkdtemp(join(tmpdir(), "docextract-ocr-"));
  try {
    const input = join(directory, "input.pdf");
    await writeFile(input, bytes);
    await tool(
      "pdftoppm",
      ["-r", String(settings.dpi), "-gray", "-png", "-l", String(settings.maxPages), input, join(directory, "page")],
      settings.pageTimeoutMs * settings.maxPages,
    );
    const images = (await readdir(directory)).filter((name) => name.startsWith("page") && name.endsWith(".png")).sort();
    if (images.length === 0) throw new OcrError("The PDF has no pages to read");

    const texts: string[] = [];
    let total = 0;
    let words = 0;
    for (const image of images) {
      const base = join(directory, image.replace(/\.png$/, ""));
      // One run writes both the text and the word confidences (base.txt and base.tsv).
      await tool(
        "tesseract",
        [join(directory, image), base, "-l", settings.language, "--psm", settings.pageSegmentation, "txt", "tsv"],
        settings.pageTimeoutMs,
      );
      texts.push(normalize(await readFile(`${base}.txt`, "utf8")));
      const counts = wordConfidences(await readFile(`${base}.tsv`, "utf8"));
      total += counts.total;
      words += counts.words;
    }
    // PostgreSQL text cannot hold NUL.
    const text = texts.filter(Boolean).join("\n\n").replaceAll("\u0000", "");
    return { text, pages: images.length, meanConfidence: words ? total / words : 0, words };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
