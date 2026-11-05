"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Re-renders the current route on an interval while background work is in progress. */
export function AutoRefresh({ intervalMs = 2000 }: { intervalMs?: number }) {
  const router = useRouter();

  useEffect(() => {
    const timer = setInterval(() => router.refresh(), intervalMs);
    return () => clearInterval(timer);
  }, [router, intervalMs]);

  return null;
}
