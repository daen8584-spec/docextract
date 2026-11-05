import type { Metadata } from "next";
import { LoginForm } from "@/components/login-form";

export const metadata: Metadata = { title: "Sign in | DocExtract" };

export default function LoginPage() {
  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-6 px-4 py-10">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold text-zinc-900">DocExtract</h1>
        <p className="text-sm text-zinc-600">Sign in to upload and review documents.</p>
      </header>
      <div className="rounded-lg border border-zinc-200 bg-white p-6">
        <LoginForm />
      </div>
    </main>
  );
}
