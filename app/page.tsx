import { Suspense } from "react";
import { DocumentTable } from "@/components/document-table";
import { UploadForm } from "@/components/upload-form";

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-10">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold text-zinc-900">Document extraction</h1>
        <p className="text-sm text-zinc-600">
          Upload a text invoice, extract structured fields with an LLM, then review and approve the result.
        </p>
      </header>
      <UploadForm />
      <Suspense fallback={<p className="text-sm text-zinc-500">Loading documents...</p>}>
        <DocumentTable />
      </Suspense>
    </main>
  );
}
