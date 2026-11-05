import type { InvoiceFields } from "./extract";

export const FIELD_KEYS = ["vendor", "invoiceNumber", "totalAmount", "currency", "dueDate"] as const satisfies readonly (keyof InvoiceFields)[];

export type FieldKey = (typeof FIELD_KEYS)[number];
export type FieldValue = InvoiceFields[FieldKey];
export type FieldCorrection = { field: FieldKey; from: FieldValue; to: FieldValue };

export const FIELD_LABELS: Record<FieldKey, string> = {
  vendor: "Vendor",
  invoiceNumber: "Invoice number",
  totalAmount: "Total amount",
  currency: "Currency",
  dueDate: "Due date",
};

/** Lists the fields a reviewer changed relative to the model output. */
export function diffFields(before: InvoiceFields | null, after: InvoiceFields): FieldCorrection[] {
  return FIELD_KEYS.flatMap((field) => {
    const from = before?.[field] ?? null;
    const to = after[field] ?? null;
    return from === to ? [] : [{ field, from, to }];
  });
}
