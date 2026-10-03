/**
 * Order activity log — data model and rendering.
 *
 * Everything the warehouse does to an order (calls, recordings, photos,
 * quantity edits, address fixes, scans, status changes) becomes an entry here.
 *
 * Shopify's public Admin API has no mutation for posting an order *timeline
 * comment* — `commentApprove/Delete/NotSpam/Spam` are blog comments, and there
 * is no `commentEventCreate`. So the log is persisted the three ways that are
 * public and merchant-visible (see activity.ts):
 *
 *   1. `oka.activity_log` metafield — the full structured record, append-only.
 *   2. The order **note** — a readable journal rendered on the order page.
 *      Each write also produces a timeline entry.
 *   3. Media uploaded to Shopify Files, linked from both.
 *
 * Line-item edits additionally go through `orderEditCommit`, which Shopify
 * itself records on the timeline as a genuine edit event with a staff note.
 *
 * This module is free of network and native dependencies so the note-rendering
 * rules can be exercised directly (see scripts/test-logic.ts).
 */

export type ActivityKind =
  | 'call'
  | 'whatsapp'
  | 'photo'
  | 'recording'
  | 'edit'
  | 'status'
  | 'scan'
  | 'cancel'
  | 'address'
  | 'note';

export type CallOutcome = 'answered' | 'noanswer' | 'wrongnumber' | 'refused';

export type ActivityEntry = {
  id: string;
  /** ISO timestamp. */
  at: string;
  kind: ActivityKind;
  /** Human-readable summary — this is what lands in the order note. */
  text: string;
  /** Who did it (device/operator label). */
  actor?: string;
  /** Shopify CDN URL for a photo or call recording. */
  mediaUrl?: string;
  /** Call duration in seconds. */
  durationSec?: number;
  outcome?: CallOutcome;
  /** Anything else worth keeping — AWB, phase, old/new quantities. */
  meta?: Record<string, string | number | boolean | null>;
};

export const ACTIVITY_NAMESPACE = 'oka';
export const ACTIVITY_KEY = 'activity_log';

/** How many entries the note journal shows; the metafield keeps everything. */
const NOTE_ENTRY_LIMIT = 25;
/** Shopify rejects notes over 5000 chars. */
const NOTE_MAX_CHARS = 4800;

const MARKER = '── OKA WAREHOUSE LOG ──';

const KIND_ICON: Record<ActivityKind, string> = {
  call: '📞',
  whatsapp: '💬',
  photo: '📷',
  recording: '🎙️',
  edit: '✏️',
  status: '🏷️',
  scan: '📦',
  cancel: '⛔',
  address: '📍',
  note: '📝',
};

/** Structural shape of what `parseActivity` needs, so this module stays standalone. */
export type ActivityMetafieldHolder = { metafield: { value: string } | null };

export function parseActivity(order: ActivityMetafieldHolder): ActivityEntry[] {
  const raw = order.metafield?.value;
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return (parsed as ActivityEntry[]).filter((e) => e && typeof e.at === 'string');
  } catch {
    return [];
  }
}

export function makeEntry(
  kind: ActivityKind,
  text: string,
  extra: Partial<Omit<ActivityEntry, 'id' | 'at' | 'kind' | 'text'>> = {},
): ActivityEntry {
  return {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    at: new Date().toISOString(),
    kind,
    text,
    ...extra,
  };
}

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  // Cairo time — the warehouse reads these, not a server.
  return d.toLocaleString('en-GB', {
    timeZone: 'Africa/Cairo',
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function formatDuration(sec?: number): string {
  if (!sec && sec !== 0) return '';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return ` [${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}]`;
}

function renderLine(e: ActivityEntry): string {
  const icon = KIND_ICON[e.kind] ?? '•';
  const actor = e.actor ? ` · ${e.actor}` : '';
  const media = e.mediaUrl ? `\n    ↳ ${e.mediaUrl}` : '';
  return `${formatTimestamp(e.at)} ${icon} ${e.text}${formatDuration(e.durationSec)}${actor}${media}`;
}

/**
 * Rebuild the note: any merchant-written text above the marker is preserved
 * verbatim, and the journal below it is regenerated from the entry list.
 */
export function renderNote(existingNote: string | null, entries: ActivityEntry[]): string {
  const preserved = (existingNote ?? '').split(MARKER)[0].trimEnd();

  const recent = entries.slice(-NOTE_ENTRY_LIMIT);
  const older = entries.length - recent.length;

  const lines = recent.map(renderLine).reverse(); // newest first
  const header =
    older > 0
      ? `${MARKER}\n(${older} earlier ${older === 1 ? 'entry' : 'entries'} in the oka.activity_log metafield)`
      : MARKER;

  let body = [header, ...lines].join('\n');

  // Trim oldest journal lines until the whole note fits.
  let dropped = 0;
  while (preserved.length + body.length + 2 > NOTE_MAX_CHARS && lines.length > 1) {
    lines.pop();
    dropped++;
    body = [
      `${MARKER}\n(${older + dropped} earlier entries in the oka.activity_log metafield)`,
      ...lines,
    ].join('\n');
  }

  return preserved ? `${preserved}\n\n${body}` : body;
}
