import { afterEach, describe, expect, it } from "vitest";
import { clientIp } from "./client-ip";

const request = (forwardedFor?: string) =>
  new Request("http://localhost/", { headers: forwardedFor ? { "x-forwarded-for": forwardedFor } : {} });

describe("clientIp", () => {
  const original = process.env.TRUSTED_PROXY_HOPS;
  afterEach(() => {
    if (original === undefined) delete process.env.TRUSTED_PROXY_HOPS;
    else process.env.TRUSTED_PROXY_HOPS = original;
  });

  it("trusts nothing without configured proxies", () => {
    delete process.env.TRUSTED_PROXY_HOPS;
    expect(clientIp(request("203.0.113.7"))).toBeNull();
  });

  it("uses the address appended by the outermost trusted proxy", () => {
    process.env.TRUSTED_PROXY_HOPS = "1";
    expect(clientIp(request("203.0.113.7"))).toBe("203.0.113.7");
    // A client-supplied prefix is ignored.
    expect(clientIp(request("1.1.1.1, 203.0.113.7"))).toBe("203.0.113.7");

    process.env.TRUSTED_PROXY_HOPS = "2";
    expect(clientIp(request("1.1.1.1, 203.0.113.7, 10.0.0.2"))).toBe("203.0.113.7");
  });

  it("returns null when the header has fewer entries than trusted proxies", () => {
    process.env.TRUSTED_PROXY_HOPS = "2";
    expect(clientIp(request("203.0.113.7"))).toBeNull();
    expect(clientIp(request())).toBeNull();
  });
});
