/**
 * Persistence for the order activity log. See activityLog.ts for the data model
 * and the rationale behind writing to note + metafield + Files.
 */

import {
  ACTIVITY_KEY,
  makeEntry,
  parseActivity,
  renderNote,
  type ActivityEntry,
  type ActivityKind,
} from './activityLog';
import { fetchOrderById, setOrderMetafield, updateOrderNoteAndTags } from './shopify';

export * from './activityLog';

/**
 * Append entries to an order and persist to Shopify.
 *
 * Re-reads the order first so a concurrent write from another handset is not
 * clobbered — two pickers working the same order is normal on a busy floor.
 * Returns the merged list so callers can update local state.
 */
export async function appendActivity(
  orderId: string,
  newEntries: ActivityEntry[],
): Promise<ActivityEntry[]> {
  if (newEntries.length === 0) return [];

  const fresh = await fetchOrderById(orderId);
  if (!fresh) throw new Error(`Order ${orderId} not found`);

  const existing = parseActivity(fresh);
  const seen = new Set(existing.map((e) => e.id));
  const merged = [...existing, ...newEntries.filter((e) => !seen.has(e.id))].sort(
    (a, b) => Date.parse(a.at) - Date.parse(b.at),
  );

  // Metafield first: it is the complete record. If the note write then fails,
  // nothing is lost and the next append repairs the note.
  await setOrderMetafield(orderId, ACTIVITY_KEY, JSON.stringify(merged), 'json');
  await updateOrderNoteAndTags(orderId, renderNote(fresh.note, merged));

  return merged;
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
