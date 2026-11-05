import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ExtractionError, extractInvoice } from "./extract";

const validFields = {
  vendor: "Acme Supplies",
  invoiceNumber: "1042",
  totalAmount: 1250,
  currency: "USD",
  dueDate: "2026-12-01",
};

const llmReply = (content: string, status = 200, extra: Record<string, unknown> = {}) =>
  new Response(JSON.stringify({ choices: [{ message: { content } }], ...extra }), { status });

describe("extractInvoice", () => {
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

    const result = await extractInvoice("Invoice 1042");
    expect(result.fields).toEqual(validFields);
    expect(result.model).toBe("test-model");
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://llm.test/v1/chat/completions");
    expect(init.headers.Authorization).toBe("Bearer test-key");
    expect(JSON.parse(init.body)).toMatchObject({ model: "test-model", temperature: 0 });
  });

  it("accepts null for fields missing from the document", async () => {
    const partial = { ...validFields, dueDate: null, currency: null };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(llmReply(JSON.stringify(partial))));

    await expect(extractInvoice("Invoice 1042")).resolves.toMatchObject({ fields: partial });
  });

  it("reports the model and token usage returned by the provider", async () => {
    const reply = llmReply(JSON.stringify(validFields), 200, {
      model: "provider-model-v2",
      usage: { prompt_tokens: 120, completion_tokens: 40, total_tokens: 160 },
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(reply));

    await expect(extractInvoice("Invoice 1042")).resolves.toMatchObject({
      model: "provider-model-v2",
      usage: { promptTokens: 120, completionTokens: 40, totalTokens: 160 },
    });
  });

  it("rejects responses that fail schema validation", async () => {
    const invalid = { ...validFields, dueDate: "Dec 1, 2026" };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(llmReply(JSON.stringify(invalid))));

    await expect(extractInvoice("x")).rejects.toThrow(/dueDate/);
  });

  it("rejects non-JSON model output", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(llmReply("Sure! Here are the fields:")));

    await expect(extractInvoice("x")).rejects.toThrow("not valid JSON");
  });

  it("surfaces upstream HTTP errors", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(llmReply("", 429)));

    await expect(extractInvoice("x")).rejects.toThrow("HTTP 429");
  });

  it("wraps network failures", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));

    await expect(extractInvoice("x")).rejects.toBeInstanceOf(ExtractionError);
  });

  it("fails fast when the provider is not configured", async () => {
    vi.stubEnv("LLM_BASE_URL", "");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(extractInvoice("x")).rejects.toThrow("must be set");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
