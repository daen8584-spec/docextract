import { describe, expect, it } from "vitest";
import type { InvoiceFields } from "./extract";
import { diffFields } from "./fields";

const base: InvoiceFields = {
  vendor: "Acme Supplies",
  invoiceNumber: "1042",
  totalAmount: 1250,
  currency: "USD",
  dueDate: "2026-12-01",
};

describe("diffFields", () => {
  it("returns no corrections when nothing changed", () => {
    expect(diffFields(base, { ...base })).toEqual([]);
  });

  it("lists each changed field with its previous and new value", () => {
    const after = { ...base, totalAmount: 1300, dueDate: null };
    expect(diffFields(base, after)).toEqual([
      { field: "totalAmount", from: 1250, to: 1300 },
      { field: "dueDate", from: "2026-12-01", to: null },
    ]);
  });

  it("treats every non-null field as a correction when there was no model output", () => {
    const after = { ...base, vendor: null, invoiceNumber: null };
    expect(diffFields(null, after).map((c) => c.field)).toEqual(["totalAmount", "currency", "dueDate"]);
  });
});
