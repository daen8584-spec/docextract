import type { DocumentStatus as Status } from "@/db/schema";

const STYLES: Record<Status, string> = {
  pending: "bg-zinc-100 text-zinc-700",
  extracted: "bg-blue-100 text-blue-800",
  approved: "bg-green-100 text-green-800",
  rejected: "bg-red-100 text-red-800",
};

export function StatusBadge({ status }: { status: Status }) {
  return <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${STYLES[status]}`}>{status}</span>;
}
