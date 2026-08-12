import type { Order } from '../api/model';
import type { FilterKey } from '../i18n/strings';

export type CallStatus = 'notcalled' | 'notanswered' | 'answered';

/** Derived from the order's own activity log, so it survives app restarts. */
export function callStatus(order: Order): CallStatus {
  const calls = order.activity.filter((e) => e.kind === 'call');
  if (calls.length === 0) return 'notcalled';
  const last = calls[calls.length - 1];
  return last.outcome === 'answered' ? 'answered' : 'notanswered';
}

export function applyFilter(orders: Order[], key: FilterKey): Order[] {
  switch (key) {
    case 'all':
      return orders;
    case 'ready':
      return orders.filter((o) => o.status === 'ready');
    case 'badaddr':
      return orders.filter((o) => o.status === 'badaddr' || o.badAddress);
    case 'cancelled':
      return orders.filter((o) => o.status === 'cancelled');
    case 'readypickup':
      return orders.filter((o) => o.tags.some((t) => t.toLowerCase() === 'oka-ready'));
    case 'notcalled':
    case 'notanswered':
    case 'answered':
      return orders.filter((o) => callStatus(o) === key);
    default:
      return orders;
  }
}

/** Photos attached to the order, newest last — read from the activity log. */
export function orderPhotos(order: Order): { url: string; at: string }[] {
  return order.activity
    .filter((e) => e.kind === 'photo' && e.mediaUrl)
    .map((e) => ({ url: e.mediaUrl as string, at: e.at }));
}

/** Call + WhatsApp entries, newest first, for the contact-history list. */
export function contactHistory(order: Order) {
  return order.activity
    .filter((e) => e.kind === 'call' || e.kind === 'whatsapp')
    .slice()
    .reverse();
}
