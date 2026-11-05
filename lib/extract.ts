import { z } from "zod";

export const invoiceFields = z.object({
  vendor: z.string().nullable(),
  invoiceNumber: z.string().nullable(),
  totalAmount: z.number().nullable(),
  currency: z.string().length(3).nullable(),
  dueDate: z.iso.date().nullable(),
});

export type InvoiceFields = z.infer<typeof invoiceFields>;

export class ExtractionError extends Error {}

const SYSTEM_PROMPT = `Extract invoice fields from the user's document.
Respond with a single JSON object with exactly these keys:
vendor (string), invoiceNumber (string), totalAmount (number without currency symbols or thousands separators),
currency (ISO 4217 code), dueDate (YYYY-MM-DD).
Use null for any field that is not present in the document. Do not guess.`;

export async function extractInvoiceFields(content: string): Promise<InvoiceFields> {
  const { LLM_BASE_URL, LLM_API_KEY, LLM_MODEL } = process.env;
  if (!LLM_BASE_URL || !LLM_MODEL) {
    throw new ExtractionError("LLM_BASE_URL and LLM_MODEL must be set");
  }

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (LLM_API_KEY) headers.Authorization = `Bearer ${LLM_API_KEY}`;

  const res = await fetch(`${LLM_BASE_URL.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: LLM_MODEL,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content },
      ],
    }),
    signal: AbortSignal.timeout(Number(process.env.LLM_TIMEOUT_MS ?? 60_000)),
  }).catch((err: Error) => {
    throw new ExtractionError(`LLM request failed: ${err.message}`);
  });

  if (!res.ok) throw new ExtractionError(`LLM returned HTTP ${res.status}`);

  const body = await res.json();
  const raw = body?.choices?.[0]?.message?.content;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ExtractionError("LLM response was not valid JSON");
  }

  const result = invoiceFields.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new ExtractionError(`LLM response failed validation: ${issues}`);
  }
  return result.data;
}
