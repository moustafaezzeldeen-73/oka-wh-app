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
/** Closes the journal, so staff text written under it survives a re-render. */
const END_MARKER = '── END OKA LOG ──';
/** Shopify's own hard cap on an order note. */
const NOTE_HARD_LIMIT = 5000;
/** A journal line ("21 Oct, 14:05 📞 …"), a media link, or the overflow line. */
const JOURNAL_LINE = /^(\d{2} [A-Za-z]{3,5},? \d{2}:\d{2} |\s{4}↳ |\(\d+ earlier )/;

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
  // One line per entry: a multi-line text would read as staff text next time.
  const text = e.text.replace(/\s*\n\s*/g, ' ');
  return `${formatTimestamp(e.at)} ${icon} ${text}${formatDuration(e.durationSec)}${actor}${media}`;
}

/**
 * The note minus OKA's journal: what staff wrote above it, and below it. Notes
 * from before the end marker existed end the journal at its last log line.
 */
export function staffNoteText(note: string | null): { above: string; below: string } {
  const s = note ?? '';
  const i = s.indexOf(MARKER);
  if (i === -1) return { above: s.trimEnd(), below: '' };
  const above = s.slice(0, i).trimEnd();
  const rest = s.slice(i + MARKER.length);
  const j = rest.indexOf(END_MARKER);
  if (j !== -1) return { above, below: rest.slice(j + END_MARKER.length).trim() };
  const lines = rest.split('\n').slice(1);
  let k = 0;
  while (k < lines.length && JOURNAL_LINE.test(lines[k])) k++;
  return { above, below: lines.slice(k).join('\n').trim() };
}

/**
 * Rebuild the note: any staff-written text above or below the journal is
 * preserved verbatim, and the journal is regenerated from the entry list.
 * When staff text leaves no room, the journal shrinks — down to nothing; the
 * metafield keeps every entry either way.
 */
export function renderNote(existingNote: string | null, entries: ActivityEntry[]): string {
  const { above, below } = staffNoteText(existingNote);
  const staffLen = above.length + below.length + 4;

  const recent = entries.slice(-NOTE_ENTRY_LIMIT);
  const older = entries.length - recent.length;
  const lines = recent.map(renderLine).reverse(); // newest first

  const bodyOf = (shown: string[], hidden: number) =>
    [
      hidden > 0 ? `${MARKER}\n(${hidden} earlier ${hidden === 1 ? 'entry' : 'entries'} in the oka.activity_log metafield)` : MARKER,
      ...shown,
      END_MARKER,
    ].join('\n');

  // Trim oldest journal lines until the whole note fits.
  let dropped = 0;
  let body = bodyOf(lines, older);
  while (staffLen + body.length > NOTE_MAX_CHARS && lines.length > 0) {
    lines.pop();
    dropped++;
    body = bodyOf(lines, older + dropped);
  }
  const join = (parts: string[]) => parts.filter(Boolean).join('\n\n');
  const out = join([above, body, below]);
  return out.length <= NOTE_HARD_LIMIT ? out : join([above, below]).slice(0, NOTE_HARD_LIMIT);
}

/** Kept well under Shopify's JSON metafield limit, and small enough to load on a slow phone. */
export const ACTIVITY_MAX_BYTES = 120_000;

/**
 * Bound the log: the oldest entries go first, and one summary entry says how
 * many were dropped (their lines are still in the Shopify timeline and note
 * history). The newest entry is never dropped.
 */
export function capEntries(entries: ActivityEntry[], maxBytes = ACTIVITY_MAX_BYTES): ActivityEntry[] {
  const size = (xs: ActivityEntry[]) => JSON.stringify(xs).length;
  if (size(entries) <= maxBytes) return entries;
  const prior = entries[0]?.id === 'trimmed' ? Number(entries[0].meta?.count ?? 0) : 0;
  let rest = entries[0]?.id === 'trimmed' ? entries.slice(1) : entries.slice();
  let dropped = 0;
  const summary = (): ActivityEntry => ({
    id: 'trimmed',
    at: rest[0]?.at ?? new Date().toISOString(),
    kind: 'note',
    text: `${prior + dropped} older log entries removed to keep the log small`,
    meta: { count: prior + dropped },
  });
  while (rest.length > 1 && size([summary(), ...rest]) > maxBytes) {
    rest = rest.slice(1);
    dropped++;
  }
  return [summary(), ...rest];
}
