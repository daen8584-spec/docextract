const BASE_URL = "http://localhost";

type RequestOptions = { cookie?: string };

function headers(options: RequestOptions, extra: Record<string, string> = {}): Record<string, string> {
  return options.cookie ? { ...extra, cookie: options.cookie } : extra;
}

export function uploadRequest(
  filename: string,
  content: string,
  options: RequestOptions & { type?: string } = {},
): Request {
  const form = new FormData();
  form.set("file", new File([content], filename, { type: options.type ?? "text/plain" }));
  return new Request(`${BASE_URL}/api/documents`, { method: "POST", body: form, headers: headers(options) });
}

export function jsonRequest(method: string, path: string, body?: unknown, options: RequestOptions = {}): Request {
  return new Request(`${BASE_URL}${path}`, {
    method,
    headers: headers(options, body === undefined ? {} : { "content-type": "application/json" }),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

export const routeParams = (id: string) => ({ params: Promise.resolve({ id }) });
