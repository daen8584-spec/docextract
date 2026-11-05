import { describe, expect, it } from "vitest";
import { compareField, failedCase, scoreCase, summarize } from "./eval";
import type { InvoiceFields } from "./extract";

const expected: InvoiceFields = {
  vendor: "Acme Supplies",
  invoiceNumber: "INV-1042",
  totalAmount: 1250,
  currency: "USD",
  dueDate: "2026-12-01",
};

describe("compareField", () => {
  it("ignores case and surrounding whitespace in text fields", () => {
    expect(compareField("vendor", "Acme Supplies", "  acme   SUPPLIES ")).toBe("correct");
  });

  it("compares amounts numerically to the cent", () => {
    expect(compareField("totalAmount", 1250, 1250.001)).toBe("correct");
    expect(compareField("totalAmount", 1250, 1250.5)).toBe("incorrect");
  });

  it("distinguishes missing values from hallucinated ones", () => {
    expect(compareField("dueDate", "2026-12-01", null)).toBe("missing");
    expect(compareField("dueDate", null, "2026-12-01")).toBe("spurious");
    expect(compareField("dueDate", null, null)).toBe("correct");
  });
});

describe("scoreCase", () => {
  it("is an exact match only when every field is correct", () => {
    expect(scoreCase("a", expected, { ...expected }).exactMatch).toBe(true);

    const result = scoreCase("b", expected, { ...expected, currency: "EUR" });
    expect(result.exactMatch).toBe(false);
    expect(result.outcomes.currency).toBe("incorrect");
  });
});

describe("summarize", () => {
  it("aggregates accuracy per field and overall", () => {
    const results = [
      scoreCase("a", expected, { ...expected }),
      scoreCase("b", expected, { ...expected, totalAmount: null }),
      failedCase("c", "LLM returned HTTP 503"),
      scoreCase("d", { ...expected, dueDate: null }, { ...expected }),
    ];

    const summary = summarize(results);

    expect(summary.cases).toBe(4);
    expect(summary.errors).toBe(1);
    expect(summary.exactMatchRate).toBe(0.25);
    expect(summary.fields.totalAmount).toMatchObject({ correct: 2, missing: 1, incorrect: 1, accuracy: 0.5 });
    expect(summary.fields.dueDate).toMatchObject({ correct: 2, spurious: 1, incorrect: 1 });
    expect(summary.fieldAccuracy).toBe(13 / 20);
  });

  it("handles an empty run", () => {
    expect(summarize([])).toMatchObject({ cases: 0, exactMatchRate: 0, fieldAccuracy: 0 });
  });
});
