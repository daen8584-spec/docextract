import type { InvoiceFields } from "./extract";
import { FIELD_KEYS, type FieldKey, type FieldValue } from "./fields";

/**
 * - correct:   the extracted value matches the expected value (or both are absent)
 * - incorrect: both present but different
 * - missing:   a value was expected but the model returned null
 * - spurious:  no value was expected but the model returned one (a hallucination)
 */
export type FieldOutcome = "correct" | "incorrect" | "missing" | "spurious";

export type CaseResult = {
  id: string;
  outcomes: Record<FieldKey, FieldOutcome>;
  exactMatch: boolean;
  error?: string;
  actual?: InvoiceFields;
};

export type FieldSummary = { accuracy: number } & Record<FieldOutcome, number>;

export type EvalSummary = {
  cases: number;
  errors: number;
  exactMatchRate: number;
  fieldAccuracy: number;
  fields: Record<FieldKey, FieldSummary>;
};

const normalizeText = (value: string) => value.trim().replace(/\s+/g, " ").toLowerCase();

function valuesMatch(field: FieldKey, expected: NonNullable<FieldValue>, actual: NonNullable<FieldValue>): boolean {
  if (field === "totalAmount") return typeof actual === "number" && Math.abs(Number(expected) - actual) < 0.005;
  return normalizeText(String(expected)) === normalizeText(String(actual));
}

export function compareField(field: FieldKey, expected: FieldValue, actual: FieldValue): FieldOutcome {
  if (expected === null) return actual === null ? "correct" : "spurious";
  if (actual === null) return "missing";
  return valuesMatch(field, expected, actual) ? "correct" : "incorrect";
}

export function scoreCase(id: string, expected: InvoiceFields, actual: InvoiceFields): CaseResult {
  const outcomes = Object.fromEntries(
    FIELD_KEYS.map((field) => [field, compareField(field, expected[field], actual[field])]),
  ) as Record<FieldKey, FieldOutcome>;
  return { id, outcomes, exactMatch: Object.values(outcomes).every((o) => o === "correct"), actual };
}

/** A case where extraction itself failed counts every field as incorrect. */
export function failedCase(id: string, error: string): CaseResult {
  const outcomes = Object.fromEntries(FIELD_KEYS.map((field) => [field, "incorrect"])) as Record<FieldKey, FieldOutcome>;
  return { id, outcomes, exactMatch: false, error };
}

const ratio = (part: number, whole: number) => (whole === 0 ? 0 : part / whole);

export function summarize(results: CaseResult[]): EvalSummary {
  const fields = Object.fromEntries(
    FIELD_KEYS.map((field) => {
      const counts: Record<FieldOutcome, number> = { correct: 0, incorrect: 0, missing: 0, spurious: 0 };
      for (const result of results) counts[result.outcomes[field]] += 1;
      return [field, { ...counts, accuracy: ratio(counts.correct, results.length) }];
    }),
  ) as Record<FieldKey, FieldSummary>;

  const correctFields = FIELD_KEYS.reduce((sum, field) => sum + fields[field].correct, 0);

  return {
    cases: results.length,
    errors: results.filter((r) => r.error !== undefined).length,
    exactMatchRate: ratio(results.filter((r) => r.exactMatch).length, results.length),
    fieldAccuracy: ratio(correctFields, results.length * FIELD_KEYS.length),
    fields,
  };
}
