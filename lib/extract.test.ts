import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ExtractionError, extractInvoiceFields } from "./extract";

const validFields = {
  vendor: "Acme Supplies",
  invoiceNumber: "1042",
  totalAmount: 1250,
  currency: "USD",
  dueDate: "2026-12-01",
};

const llmReply = (content: string, status = 200) =>
  new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status });

describe("extractInvoiceFields", () => {
  beforeEach(() => {
    vi.stubEnv("LLM_BASE_URL", "https://llm.test/v1");
    vi.stubEnv("LLM_MODEL", "test-model");
    vi.stubEnv("LLM_API_KEY", "test-key");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("returns validated fields from a well-formed response", async () => {
    const fetchMock = vi.fn().mockResolvedValue(llmReply(JSON.stringify(validFields)));
    vi.stubGlobal("fetch", fetchMock);

    await expect(extractInvoiceFields("Invoice 1042")).resolves.toEqual(validFields);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://llm.test/v1/chat/completions");
    expect(init.headers.Authorization).toBe("Bearer test-key");
    expect(JSON.parse(init.body)).toMatchObject({ model: "test-model", temperature: 0 });
  });

  it("accepts null for fields missing from the document", async () => {
    const partial = { ...validFields, dueDate: null, currency: null };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(llmReply(JSON.stringify(partial))));

    await expect(extractInvoiceFields("Invoice 1042")).resolves.toEqual(partial);
  });

  it("rejects responses that fail schema validation", async () => {
    const invalid = { ...validFields, dueDate: "Dec 1, 2026" };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(llmReply(JSON.stringify(invalid))));

    await expect(extractInvoiceFields("x")).rejects.toThrow(/dueDate/);
  });

  it("rejects non-JSON model output", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(llmReply("Sure! Here are the fields:")));

    await expect(extractInvoiceFields("x")).rejects.toThrow("not valid JSON");
  });

  it("surfaces upstream HTTP errors", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(llmReply("", 429)));

    await expect(extractInvoiceFields("x")).rejects.toThrow("HTTP 429");
  });

  it("wraps network failures", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));

    await expect(extractInvoiceFields("x")).rejects.toBeInstanceOf(ExtractionError);
  });

  it("fails fast when the provider is not configured", async () => {
    vi.stubEnv("LLM_BASE_URL", "");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(extractInvoiceFields("x")).rejects.toThrow("must be set");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
