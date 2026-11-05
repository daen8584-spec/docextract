export const SESSION_COOKIE = "docextract_session";

/** Reads a single cookie value from a Cookie request header. */
export function readCookie(header: string | null, name: string): string | null {
  if (!header) return null;

  for (const pair of header.split(";")) {
    const separator = pair.indexOf("=");
    if (separator === -1) continue;
    if (pair.slice(0, separator).trim() !== name) continue;

    const value = pair.slice(separator + 1).trim();
    try {
      return decodeURIComponent(value);
    } catch {
      return null;
    }
  }
  return null;
}
