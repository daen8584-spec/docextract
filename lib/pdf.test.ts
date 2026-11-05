import { describe, expect, it } from "vitest";
import { makePdf } from "@/tests/fixtures/pdf";
import { AppError } from "./errors";
import { extractPdfText, looksLikePdf, MAX_PDF_PAGES } from "./pdf";

async function failure(promise: Promise<unknown>): Promise<AppError> {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(AppError);
  return error as AppError;
}

describe("extractPdfText", () => {
  it("returns the text layer of every page", async () => {
    const pdf = makePdf([
      ["INVOICE INV-2042", "Vendor: Acme (Supplies) Ltd"],
      ["Total due: 1,250.00 USD"],
    ]);

    const { text, pages } = await extractPdfText(pdf);

    expect(pages).toBe(2);
    expect(text).toContain("INVOICE INV-2042");
    expect(text).toContain("Acme (Supplies) Ltd");
    expect(text).toContain("1,250.00 USD");
    expect(text.indexOf("INV-2042")).toBeLessThan(text.indexOf("1,250.00"));
  });

  it("rejects content that is not a PDF, whatever its declared type", async () => {
    const error = await failure(extractPdfText(new TextEncoder().encode("Invoice 1042")));
    expect(error.code).toBe("UNSUPPORTED_MEDIA_TYPE");
  });

  it("rejects a damaged PDF", async () => {
    const error = await failure(extractPdfText(new TextEncoder().encode("%PDF-1.4\nthis is not a pdf body")));
    expect(error.code).toBe("UNPROCESSABLE_CONTENT");
  });

  it("rejects a PDF without a text layer, such as a scan", async () => {
    const error = await failure(extractPdfText(makePdf([[]])));
    expect(error.code).toBe("UNPROCESSABLE_CONTENT");
    expect(error.message).toMatch(/no text layer/);
  });

  it("enforces the page limit", async () => {
    const pages = Array.from({ length: MAX_PDF_PAGES + 1 }, (_, i) => [`Page ${i + 1}`]);
    const error = await failure(extractPdfText(makePdf(pages)));
    expect(error.code).toBe("PAYLOAD_TOO_LARGE");
  });
});

describe("looksLikePdf", () => {
  it("checks the file header", () => {
    expect(looksLikePdf(makePdf([["x"]]))).toBe(true);
    expect(looksLikePdf(new TextEncoder().encode("%PD"))).toBe(false);
  });
});
