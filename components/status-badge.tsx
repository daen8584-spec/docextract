import type { DocumentStatus } from "@/db/schema";

const STYLES: Record<DocumentStatus, string> = {
  queued: "bg-zinc-100 text-zinc-700",
  processing: "bg-amber-100 text-amber-800",
  extracted: "bg-blue-100 text-blue-800",
  failed: "bg-orange-100 text-orange-800",
  approved: "bg-green-100 text-green-800",
  rejected: "bg-red-100 text-red-800",
};

export const isInProgress = (status: DocumentStatus) => status === "queued" || status === "processing";

export function StatusBadge({ status }: { status: DocumentStatus }) {
  return <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${STYLES[status]}`}>{status}</span>;
}
