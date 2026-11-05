import { eq } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { z } from "zod";
import { db } from "@/db";
import { documents } from "@/db/schema";
import { ReviewPanel } from "@/components/review-panel";
import { StatusBadge } from "@/components/status-badge";
import type { InvoiceFields } from "@/lib/extract";

type Props = { params: Promise<{ id: string }> };

export default function DocumentPage({ params }: Props) {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-10">
      <Link href="/" className="text-sm text-zinc-600 hover:underline">
        Back to documents
      </Link>
      <Suspense fallback={<p className="text-sm text-zinc-500">Loading document...</p>}>
        <DocumentDetail params={params} />
      </Suspense>
    </main>
  );
}

async function DocumentDetail({ params }: Props) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();

  const [doc] = await db.select().from(documents).where(eq(documents.id, id)).limit(1);
  if (!doc) notFound();

  return (
    <>
      <header className="flex items-center gap-3">
        <h1 className="text-2xl font-semibold text-zinc-900">{doc.filename}</h1>
        <StatusBadge status={doc.status} />
      </header>
      <div className="grid gap-6 md:grid-cols-2">
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-500">Source</h2>
          <pre className="overflow-x-auto whitespace-pre-wrap rounded-lg border border-zinc-200 bg-white p-4 text-sm text-zinc-800">
            {doc.content}
          </pre>
        </section>
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-500">Extracted fields</h2>
          <div className="rounded-lg border border-zinc-200 bg-white p-4">
            <ReviewPanel id={doc.id} status={doc.status} fields={doc.extracted as InvoiceFields | null} />
          </div>
        </section>
      </div>
    </>
  );
}
