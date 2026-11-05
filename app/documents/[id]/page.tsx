import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { AppHeader } from "@/components/app-header";
import { EventTimeline } from "@/components/event-timeline";
import { ReviewPanel } from "@/components/review-panel";
import { StatusBadge } from "@/components/status-badge";
import { isReviewer, type SessionUser } from "@/lib/auth";
import { requirePageUser } from "@/lib/current-user";
import { getDocument, listDocumentEvents } from "@/lib/documents";
import { AppError } from "@/lib/errors";
import type { InvoiceFields } from "@/lib/extract";
import { parseDocumentId } from "@/lib/http";

type Props = { params: Promise<{ id: string }> };

export default function DocumentPage({ params }: Props) {
  return (
    <Suspense fallback={<p className="px-4 py-10 text-sm text-zinc-500">Loading document...</p>}>
      <DocumentDetail params={params} />
    </Suspense>
  );
}

async function loadDocument(user: SessionUser, rawId: string) {
  try {
    return await getDocument(user, parseDocumentId(rawId));
  } catch (error) {
    if (error instanceof AppError && (error.code === "NOT_FOUND" || error.code === "BAD_REQUEST")) notFound();
    throw error;
  }
}

async function DocumentDetail({ params }: Props) {
  const user = await requirePageUser();
  const doc = await loadDocument(user, (await params).id);
  const events = await listDocumentEvents(user, doc.id);

  return (
    <>
      <AppHeader user={user} />
      <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-10">
        <Link href="/" className="text-sm text-zinc-600 hover:underline">
          Back to documents
        </Link>
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
              <ReviewPanel
                id={doc.id}
                status={doc.status}
                fields={doc.extracted as InvoiceFields | null}
                canReview={isReviewer(user)}
              />
            </div>
          </section>
        </div>
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-500">Activity</h2>
          <div className="rounded-lg border border-zinc-200 bg-white p-4">
            <EventTimeline events={events} />
          </div>
        </section>
      </main>
    </>
  );
}
