import { describe, expect, it } from "vitest";
import { GET as me } from "@/app/api/auth/me/route";
import { jsonRequest } from "./requests";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe("request ids", () => {
  it("assigns a request id to every response, including errors", async () => {
    const res = await me(jsonRequest("GET", "/api/auth/me"), undefined);

    expect(res.status).toBe(401);
    expect(res.headers.get("x-request-id")).toMatch(UUID);
  });

  it("propagates a well-formed caller request id", async () => {
    const request = jsonRequest("GET", "/api/auth/me");
    request.headers.set("x-request-id", "edge-7f3a.42");

    const res = await me(request, undefined);
    expect(res.headers.get("x-request-id")).toBe("edge-7f3a.42");
  });

  it.each([["contains spaces and quotes", 'abc "injected"'], ["is too long", "x".repeat(200)]])(
    "replaces a caller request id that %s",
    async (_case, value) => {
      const request = jsonRequest("GET", "/api/auth/me");
      request.headers.set("x-request-id", value);

      const res = await me(request, undefined);
      expect(res.headers.get("x-request-id")).toMatch(UUID);
    },
  );
});
