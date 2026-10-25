/**
 * Persistence for the order activity log. See activityLog.ts for the data model
 * and the rationale behind writing to note + metafield + Files.
 */

import {
  ACTIVITY_KEY,
  capEntries,
  makeEntry,
  parseActivity,
  renderNote,
  type ActivityEntry,
  type ActivityKind,
} from './activityLog';
import { fetchOrderById, setOrderMetafield, StaleWriteError, updateOrderNoteAndTags } from './shopify';

export * from './activityLog';

/** One write at a time per order from this handset: later appends wait for earlier ones. */
const queues = new Map<string, Promise<unknown>>();

/**
 * Append entries to an order and persist to Shopify.
 *
 * Re-reads the order first and writes with the metafield's digest, so a
 * concurrent write from another handset is never clobbered — two pickers
 * working the same order is normal on a busy floor. A lost race re-reads and
 * merges again. Returns the merged list so callers can update local state.
 */
export function appendActivity(orderId: string, newEntries: ActivityEntry[]): Promise<ActivityEntry[]> {
  if (newEntries.length === 0) return Promise.resolve([]);
  const prev = queues.get(orderId) ?? Promise.resolve();
  const run = prev.catch(() => undefined).then(() => writeEntries(orderId, newEntries));
  queues.set(orderId, run);
  void run.finally(() => {
    if (queues.get(orderId) === run) queues.delete(orderId);
  }).catch(() => undefined);
  return run;
}

async function writeEntries(orderId: string, newEntries: ActivityEntry[]): Promise<ActivityEntry[]> {
  for (let attempt = 0; ; attempt++) {
    const fresh = await fetchOrderById(orderId);
    if (!fresh) throw new Error(`Order ${orderId} not found`);

    const existing = parseActivity(fresh);
    const seen = new Set(existing.map((e) => e.id));
    const merged = capEntries(
      [...existing, ...newEntries.filter((e) => !seen.has(e.id))].sort(
        (a, b) => Date.parse(a.at) - Date.parse(b.at),
      ),
    );

    // Metafield first: it is the complete record. If the note write then fails,
    // nothing is lost and the next append repairs the note.
    try {
      await setOrderMetafield(orderId, ACTIVITY_KEY, JSON.stringify(merged), 'json', fresh.metafield?.compareDigest);
    } catch (err) {
      if (err instanceof StaleWriteError && attempt < 3) continue;
      throw err;
    }
    await updateOrderNoteAndTags(orderId, renderNote(fresh.note, merged));
    return merged;
  }
}

/** Convenience: build one entry and persist it. */
export async function logActivity(
  orderId: string,
  kind: ActivityKind,
  text: string,
  extra: Partial<Omit<ActivityEntry, 'id' | 'at' | 'kind' | 'text'>> = {},
): Promise<ActivityEntry[]> {
  return appendActivity(orderId, [makeEntry(kind, text, extra)]);
}
