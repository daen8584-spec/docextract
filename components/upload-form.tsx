"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

export function UploadForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setPending(true);
    setError(null);

    const res = await fetch("/api/documents", { method: "POST", body: new FormData(form) });
    setPending(false);

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? `Upload failed (HTTP ${res.status})`);
      return;
    }
    form.reset();
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-wrap items-center gap-3 rounded-lg border border-zinc-200 bg-white p-4">
      <label htmlFor="file" className="text-sm font-medium text-zinc-700">Text document</label>
      <input id="file" name="file" type="file" accept=".txt,text/plain" required className="text-sm text-zinc-700 file:mr-3 file:rounded-md file:border-0 file:bg-zinc-100 file:px-3 file:py-2 file:text-sm file:font-medium file:text-zinc-800 hover:file:bg-zinc-200" />
      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50"
      >
        {pending ? "Uploading..." : "Upload"}
      </button>
      {error && <p role="alert" className="w-full text-sm text-red-600">{error}</p>}
    </form>
  );
}
