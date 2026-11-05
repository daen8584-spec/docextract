"use client";

import { useRouter } from "next/navigation";

export function SignOutButton() {
  const router = useRouter();

  async function signOut() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
    router.refresh();
  }

  return (
    <button type="button" onClick={signOut} className="text-sm text-zinc-600 hover:text-zinc-900 hover:underline">
      Sign out
    </button>
  );
}
