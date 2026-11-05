# 0007. Extract the PDF text layer at upload time

- Status: Accepted
- Date: 2026-11-05

## Context

Invoices and receipts usually arrive as PDFs. The extraction pipeline works on text, so a PDF must be converted to text somewhere. The options are a library that reads the PDF's text layer, optical character recognition for scanned documents, or sending the PDF to a model that accepts files.

## Decision

- Read the text layer with PDF.js (through `unpdf`, a build of PDF.js for server environments) when the file is uploaded, and store the text as the document content. The worker, the review screen and the evaluation harness then handle PDFs and text files identically.
- Check the file header rather than trusting the declared content type, and reject damaged or encrypted files with `422`, and files over 10 MB or 50 pages with `413`.
- Reject PDFs without a text layer, such as scans, with a clear message instead of storing an empty document that would fail extraction later.
- Load PDF.js from `node_modules` at runtime instead of bundling it with the application.

## Consequences

- Text-based PDFs work end to end, and failures are reported to the uploader immediately, before a job is queued.
- Scanned documents are not supported. Supporting them requires OCR (for example Tesseract) or a model that accepts images, at a higher cost per document.
- Extraction of very large PDFs runs in the request. The page and size limits bound this; moving extraction to the worker would be the next step if larger files were needed.
