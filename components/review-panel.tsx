"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import type { InvoiceFields } from "@/lib/extract";

type Status = "pending" | "extracted" | "approved" | "rejected";

const FIELDS = [
  { key: "vendor", label: "Vendor", type: "text" },
  { key: "invoiceNumber", label: "Invoice number", type: "text" },
  { key: "totalAmount", label: "Total amount", type: "number" },
  { key: "currency", label: "Currency (ISO 4217)", type: "text" },
  { key: "dueDate", label: "Due date", type: "date" },
] as const;

function toFields(form: HTMLFormElement): InvoiceFields {
  const data = new FormData(form);
  const read = (key: string) => {
    const value = String(data.get(key) ?? "").trim();
    return value === "" ? null : value;
  };
  const total = read("totalAmount");
  return {
    vendor: read("vendor"),
    invoiceNumber: read("invoiceNumber"),
    totalAmount: total === null ? null : Number(total),
    currency: read("currency")?.toUpperCase() ?? null,
    dueDate: read("dueDate"),
  };
}

export function ReviewPanel({ id, status, fields }: { id: string; status: Status; fields: InvoiceFields | null }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send(url: string, init: RequestInit) {
    setPending(true);
    setError(null);
    const res = await fetch(url, init);
    setPending(false);

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      const detail = body.issues
        ?.map((i: { path: string[]; message: string }) => `${i.path.join(".")}: ${i.message}`)
        .join("; ");
      setError([body.error ?? `Request failed (HTTP ${res.status})`, detail].filter(Boolean).join(". "));
      return;
    }
    router.refresh();
  }

  const review = (body: object) =>
    send(`/api/documents/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

  function onApprove(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    review({ action: "approve", fields: toFields(event.currentTarget) });
  }

  const button = "rounded-md px-4 py-2 text-sm font-medium disabled:opacity-50";
  const errorMessage = error && <p role="alert" className="text-sm text-red-600">{error}</p>;

  if (status === "pending") {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-sm text-zinc-600">Fields have not been extracted yet.</p>
        <button
          type="button"
          disabled={pending}
          onClick={() => send(`/api/documents/${id}/extract`, { method: "POST" })}
          className={`${button} self-start bg-zinc-900 text-white hover:bg-zinc-700`}
        >
          {pending ? "Extracting..." : "Extract fields"}
        </button>
        {errorMessage}
      </div>
    );
  }

  if (status === "extracted") {
    return (
      <form onSubmit={onApprove} className="flex flex-col gap-4">
        {FIELDS.map((field) => (
          <label key={field.key} className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-zinc-700">{field.label}</span>
            <input
              name={field.key}
              type={field.type}
              step={field.type === "number" ? "0.01" : undefined}
              defaultValue={fields?.[field.key] ?? ""}
              className="rounded-md border border-zinc-300 px-3 py-2 text-zinc-900 focus:border-zinc-900 focus:outline-none"
            />
          </label>
        ))}
        {errorMessage}
        <div className="flex gap-3">
          <button type="submit" disabled={pending} className={`${button} bg-green-700 text-white hover:bg-green-800`}>
            Approve
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => review({ action: "reject" })}
            className={`${button} border border-zinc-300 text-zinc-700 hover:bg-zinc-100`}
          >
            Reject
          </button>
        </div>
      </form>
    );
  }

  return (
    <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2 text-sm">
      {FIELDS.map((field) => (
        <div key={field.key} className="contents">
          <dt className="font-medium text-zinc-500">{field.label}</dt>
          <dd className="text-zinc-900">{fields?.[field.key] ?? "Not present"}</dd>
        </div>
      ))}
    </dl>
  );
}
