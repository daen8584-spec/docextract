import { extractText, getDocumentProxy } from "unpdf";
import { AppError } from "./errors";

export const MAX_PDF_PAGES = 50;

/** True when the bytes start with the PDF header, regardless of the declared content type. */
export function looksLikePdf(bytes: Uint8Array): boolean {
  return bytes.length >= 5 && new TextDecoder().decode(bytes.subarray(0, 5)) === "%PDF-";
}

/**
 * Extracts the text layer of a PDF with PDF.js. Scanned documents have no text layer
 * and are rejected rather than stored empty, because extraction would only fail later.
 */
export async function extractPdfText(bytes: Uint8Array): Promise<{ text: string; pages: number }> {
  if (!looksLikePdf(bytes)) {
    throw new AppError("UNSUPPORTED_MEDIA_TYPE", "File content is not a PDF");
  }
  // PDF.js may take ownership of the buffer, so it gets a copy.
  const pdf = await getDocumentProxy(new Uint8Array(bytes)).catch(() => {
    throw new AppError("UNPROCESSABLE_CONTENT", "The PDF could not be read. It may be damaged or encrypted.");
  });
  if (pdf.numPages > MAX_PDF_PAGES) {
    throw new AppError("PAYLOAD_TOO_LARGE", `PDF has ${pdf.numPages} pages; the limit is ${MAX_PDF_PAGES}`);
  }
  const { text } = await extractText(pdf, { mergePages: true });
  const normalized = text
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (normalized.length === 0) {
    throw new AppError(
      "UNPROCESSABLE_CONTENT",
      "The PDF has no text layer. Scanned documents are not supported; upload a PDF with selectable text.",
    );
  }
  return { text: normalized, pages: pdf.numPages };
}
