type ErrorDetail = { path?: (string | number)[]; message?: string };

/** Builds a readable message from the JSON error body returned by the API. */
export async function apiErrorMessage(response: Response): Promise<string> {
  const body: { error?: string; details?: unknown } = await response.json().catch(() => ({}));
  const details = Array.isArray(body.details)
    ? (body.details as ErrorDetail[])
        .map((d) => (d.path?.length ? `${d.path.join(".")}: ${d.message}` : d.message))
        .filter(Boolean)
        .join("; ")
    : "";
  return [body.error ?? `Request failed (HTTP ${response.status})`, details].filter(Boolean).join(". ");
}
