import { desc } from "drizzle-orm";
import Link from "next/link";
import { connection } from "next/server";
import { db } from "@/db";
import { documents } from "@/db/schema";
import { StatusBadge } from "./status-badge";

const formatDate = (date: Date) => date.toISOString().slice(0, 16).replace("T", " ");

export async function DocumentTable() {
  await connection();

  const rows = await db
    .select({ id: documents.id, filename: documents.filename, status: documents.status, createdAt: documents.createdAt })
    .from(documents)
    .orderBy(desc(documents.createdAt))
    .limit(50);

  if (rows.length === 0) {
    return <p className="text-sm text-zinc-500">No documents yet. Upload one to get started.</p>;
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-zinc-200 text-xs uppercase tracking-wide text-zinc-500">
          <tr>
            <th className="px-4 py-3 font-medium">Document</th>
            <th className="px-4 py-3 font-medium">Status</th>
            <th className="px-4 py-3 font-medium">Uploaded (UTC)</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-100">
          {rows.map((doc) => (
            <tr key={doc.id} className="hover:bg-zinc-50">
              <td className="px-4 py-3">
                <Link href={`/documents/${doc.id}`} className="font-medium text-zinc-900 hover:underline">
                  {doc.filename}
                </Link>
              </td>
              <td className="px-4 py-3"><StatusBadge status={doc.status} /></td>
              <td className="px-4 py-3 text-zinc-600">{formatDate(doc.createdAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
