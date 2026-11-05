import type { DocumentEventType } from "@/db/schema";
import { FIELD_LABELS, type FieldCorrection } from "@/lib/fields";

type TimelineEvent = {
  id: string;
  type: DocumentEventType;
  data: unknown;
  createdAt: Date;
  actor: { id: string; name: string } | null;
};

const LABELS: Record<DocumentEventType, string> = {
  uploaded: "Uploaded",
  extraction_queued: "Extraction queued",
  extraction_started: "Extraction started",
  extraction_succeeded: "Fields extracted",
  extraction_failed: "Extraction failed",
  approved: "Approved",
  rejected: "Rejected",
};

const formatTime = (date: Date) => date.toISOString().slice(0, 19).replace("T", " ");
const formatValue = (value: unknown) => (value === null || value === undefined ? "empty" : String(value));

function EventDetails({ data }: { data: unknown }) {
  if (!data || typeof data !== "object") return null;
  const { corrections, error, model, latencyMs, usage } = data as {
    corrections?: FieldCorrection[];
    error?: string;
    model?: string;
    latencyMs?: number;
    usage?: { totalTokens: number } | null;
  };

  return (
    <>
      {model && (
        <p className="text-xs text-zinc-600">
          {model} in {latencyMs} ms{usage ? `, ${usage.totalTokens} tokens` : ""}
        </p>
      )}
      {corrections?.map((c) => (
        <p key={c.field} className="text-xs text-zinc-600">
          {FIELD_LABELS[c.field]} corrected from {formatValue(c.from)} to {formatValue(c.to)}
        </p>
      ))}
      {error && <p className="text-xs text-red-700">{error}</p>}
    </>
  );
}

export function EventTimeline({ events }: { events: TimelineEvent[] }) {
  if (events.length === 0) return <p className="text-sm text-zinc-500">No activity recorded.</p>;

  return (
    <ol className="flex flex-col gap-3">
      {events.map((event) => (
        <li key={event.id} className="flex flex-col gap-0.5 border-l-2 border-zinc-200 pl-3">
          <p className="text-sm text-zinc-900">
            <span className="font-medium">{LABELS[event.type]}</span>
            <span className="text-zinc-500"> by {event.actor?.name ?? "system"}</span>
          </p>
          <p className="text-xs text-zinc-500">{formatTime(event.createdAt)} UTC</p>
          <EventDetails data={event.data} />
        </li>
      ))}
    </ol>
  );
}
