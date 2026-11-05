/**
 * The client's IP address, or null when it cannot be determined without trusting
 * data the client controls.
 *
 * Route handlers do not see the socket address, and X-Forwarded-For is set by the
 * client unless a proxy overwrites or appends to it. With TRUSTED_PROXY_HOPS=N, the
 * application runs behind N proxies that each append the address they received the
 * request from, so the Nth entry from the end was written by the outermost trusted
 * proxy and is the real client address. Entries before it are ignored because the
 * client can put anything there.
 */
export function clientIp(request: Request): string | null {
  const hops = Number(process.env.TRUSTED_PROXY_HOPS ?? "0");
  if (!Number.isInteger(hops) || hops <= 0) return null;
  const forwarded = request.headers.get("x-forwarded-for");
  if (!forwarded) return null;
  const addresses = forwarded
    .split(",")
    .map((address) => address.trim())
    .filter((address) => address.length > 0);
  return addresses.length >= hops ? addresses[addresses.length - hops] : null;
}
