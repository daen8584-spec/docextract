import Link from "next/link";
import type { SessionUser } from "@/lib/auth";
import { SignOutButton } from "./sign-out-button";

export function AppHeader({ user }: { user: SessionUser }) {
  return (
    <header className="border-b border-zinc-200 bg-white">
      <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-4 px-4 py-3">
        <Link href="/" className="font-semibold text-zinc-900">
          DocExtract
        </Link>
        <div className="flex items-center gap-4">
          <span className="text-sm text-zinc-700">
            {user.name}
            <span className="ml-2 rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-700">
              {user.role}
            </span>
          </span>
          <SignOutButton />
        </div>
      </div>
    </header>
  );
}
