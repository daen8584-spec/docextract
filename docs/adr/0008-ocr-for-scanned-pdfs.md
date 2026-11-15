# 0008. Read scanned PDFs with Tesseract OCR in the worker

- Status: Accepted
- Date: 2026-11-15
- Amends: [0007](0007-pdf-text-extraction.md)

## Context

[0007](0007-pdf-text-extraction.md) rejected PDFs without a text layer, which excluded scanned invoices and receipts, a common way documents arrive. Supporting them needs optical character recognition. OCR takes about a second per page, too long to run inside the upload request, and its output can be wrong in ways the model will not notice: a misread digit is still a plausible amount.

## Decision

- **Tesseract, run in the worker.** At upload, a PDF whose text layer is empty is stored as-is (`documents.original_pdf`) with empty content, when OCR is enabled (`OCR_ENABLED=true`). The extraction job renders its pages with `pdftoppm` at 300 dpi in grayscale, reads each page with Tesseract, and stores the text as the document content. Tesseract runs as an installed command, which keeps the application free of native modules; the container image includes it.
- **OCR is saved before extraction.** The text, the cleared PDF and an OCR summary are committed in their own transaction, with an `ocr_completed` audit event, before the model is called. An extraction failure retried by the queue reuses the text instead of repeating OCR. An OCR failure (a missing tool, a timeout, no text found) is recorded and retried like an extraction failure, and the PDF is kept for the retry.
- **Bounded work.** Uploads with more pages than `OCR_MAX_PAGES` (10) are rejected with `413` before they are stored, and each page has a timeout (`OCR_PAGE_TIMEOUT_MS`, 60 s).
- **Confidence is shown to the reviewer.** The mean Tesseract word confidence is stored with the document. Below `OCR_MIN_CONFIDENCE` (60) the review page asks the reviewer to check every field against the original. Every document is reviewed before approval in any case ([0005](0005-untrusted-llm-output.md)).
- **Page segmentation mode 6 by default** (a single uniform block of text), and typographic quotes normalized to straight ones; see below.
- **The stored PDF is not sent to browsers.** The document query excludes it.

## Measurements

`npm run eval:ocr` renders each evaluation case as a scanned PDF (an image-only PDF at the given scan resolution) and reads it back with the pipeline above, then compares the text with the original. 16 of the 20 cases are used; the 4 with non-ASCII characters are skipped because the test PDF generator writes ASCII only. OCR took about one second per page.

| Version | Character error rate, 150 dpi scan | 300 dpi scan | Cases recovered exactly (300 dpi) |
| --- | ---: | ---: | ---: |
| Tesseract defaults (page segmentation mode 3) | 2.27% | 1.94% | 13 of 16 |
| Straight quotes restored | 2.16% | 1.84% | 15 of 16 |
| Mode 4 (single column) | 0.79% | 0.68% | 15 of 16 |
| Mode 6 (uniform block), the default | 0.40% | 0.54% | 14 of 16 |

The first run showed two problems that matter for invoices:

- With its default mode, Tesseract dropped the line `TOTAL DUE ....... USD 1,274.40` of case 13 entirely: it treated the dot leaders as layout. Modes 4 and 6 keep the line.
- Tesseract returned typographic apostrophes, which changed the Swiss amount `12'463.93` to `12’463.93`.

With mode 6, the remaining differences are case 13, whose original deliberately contains OCR-like noise (Tesseract corrects `INV0ICE` to `INVOICE` and garbles a dot leader), and a stray `°` in the Swiss total of case 18 (`12'°463.93`) at one of the two resolutions. Errors of that kind are what the reviewer's check exists for.

This measures the text OCR recovers, not field accuracy after extraction, which needs an LLM. The test cases are clean, single-column renderings; real scans with skew, noise or multiple columns will do worse, and multi-column layouts may favor mode 4 (`OCR_PSM=4`).

## Consequences

- Scanned PDFs work end to end: uploaded in milliseconds, read by the worker, then extracted and reviewed like any other document. CI uploads a scanned PDF to the containers and checks the worker reads its text.
- The image grows by Tesseract, its English data and poppler-utils. Other languages need their Tesseract data and `OCR_LANGUAGE`.
- A scanned PDF is kept in the database until OCR succeeds, up to the 10 MB upload limit.
- OCR text replaces the empty content, so the review page, the audit log and the evaluation export see OCR documents like text documents.
