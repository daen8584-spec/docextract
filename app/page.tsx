import { Suspense } from "react";
import { AppHeader } from "@/components/app-header";
import { DocumentTable } from "@/components/document-table";
import { UploadForm } from "@/components/upload-form";
import { requirePageUser } from "@/lib/current-user";

export default function Home() {
  return (
    <Suspense fallback={<p className="px-4 py-10 text-sm text-zinc-500">Loading...</p>}>
      <HomeContent />
    </Suspense>
  );
}

async function HomeContent() {
  const user = await requirePageUser();

  return (
    <>
      <AppHeader user={user} />
      <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-10">
        <header className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold text-zinc-900">Documents</h1>
          <p className="text-sm text-zinc-600">
            Upload a text invoice, extract structured fields with an LLM, then review and approve the result.
          </p>
        </header>
        <UploadForm />
        <DocumentTable user={user} />
      </main>
    </>
  );
}
