/**
 * Order search: the order list's free-text box and the shipping-status phone
 * search. Arabic-Indic digits, Arabic letter variants and +20 / 0020 phone
 * prefixes all fold together.
 */

import { normalizeText } from './analytics';
import { toLatinDigits, type Order } from './model';

/** A phone as typed — any digits, +20 / 0020 / 0 prefixes — as its national form "01…". */
export function nationalPhone(raw: string): string {
  let d = toLatinDigits(raw).replace(/\D/g, '');
  if (d.startsWith('0020')) d = `0${d.slice(4)}`;
  else if (d.startsWith('20') && d.length >= 12) d = `0${d.slice(2)}`;
  return d;
}

/** Phone search for the shipping-status screen — matches Shopify and both couriers. */
export function searchByPhone(orders: Order[], query: string): Order[] {
  if (!query.trim()) return orders;
  const digits = nationalPhone(query);
  // Text with no digits matches nothing (it used to return every order).
  if (!digits) return [];
  return orders.filter(
    (o) =>
      nationalPhone(o.phone).includes(digits) ||
      (o.awb ?? '').includes(digits) ||
      o.name.replace(/\D/g, '').includes(digits),
  );
}

/** Free-text search for the order list: Arabic letter variants and digits fold together. */
export function searchOrders(orders: Order[], query: string): Order[] {
  const raw = toLatinDigits(query).trim();
  if (!raw) return orders;
  const q = normalizeText(raw);
  const digits = nationalPhone(raw);
  const has = (s: string | null | undefined) => normalizeText(toLatinDigits(s)).includes(q);
  return orders.filter(
    (o) =>
      has(o.name) ||
      has(o.customerName) ||
      has(o.city) ||
      has(o.awb) ||
      has(o.carrierName) ||
      (digits.length > 0 &&
        ((o.awb ?? '').includes(digits) || nationalPhone(o.phone).includes(digits))),
  );
}
