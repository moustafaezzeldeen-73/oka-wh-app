/**
 * Turns the edit screen's draft into Shopify order-edit calls.
 *
 * OKA fulfils an order when it books it with the courier, so most edits land
 * on fulfilled lines. Shopify can't take fulfilled units off a line, and on a
 * partly fulfilled line the editable part is what `orderEditSetQuantity`
 * changes — so the plan works in editable units, refuses a decrease below
 * what was fulfilled, and says what total each staged line must come back
 * with. The caller checks that before committing.
 */

/** A line of Shopify's calculated order, as `orderEditBegin` returns it. */
export type CalcLine = {
  id: string;
  title: string;
  /** All units on the line, fulfilled or not. */
  quantity: number;
  /** Units the edit can still change (the unfulfilled ones). */
  editableQuantity: number;
  variantId: string | null;
};

export type DraftItem = { lineItemId: string; variantId: string | null; title: string; quantity: number };

export type QtyStep = {
  calcLineId: string;
  title: string;
  from: number;
  to: number;
  /** The quantity argument for `orderEditSetQuantity`: editable units. */
  editable: number;
};

export type AddStep = { variantId: string; title: string; quantity: number };

export type EditPlan = { setQuantities: QtyStep[]; addVariants: AddStep[] };

export class EditRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EditRefused';
  }
}

/** "gid://shopify/LineItem/123" and "gid://shopify/CalculatedLineItem/123" share the number. */
const numericId = (gid: string) => gid.match(/(\d+)$/)?.[1] ?? gid;

function findCalcLine(lines: CalcLine[], item: DraftItem): CalcLine | undefined {
  const id = numericId(item.lineItemId);
  return (
    lines.find((l) => numericId(l.id) === id) ??
    lines.find((l) => item.variantId !== null && l.variantId === item.variantId && l.quantity === item.quantity) ??
    lines.find((l) => l.title === item.title && l.quantity === item.quantity)
  );
}

export function planOrderEdit(
  lines: CalcLine[],
  items: DraftItem[],
  quantities: Record<string, number>,
  additions: { variantId: string; title: string }[],
): EditPlan {
  // Desired total per calculated line.
  const want = new Map<string, { line: CalcLine; to: number }>();
  for (const [lineItemId, qty] of Object.entries(quantities)) {
    const item = items.find((i) => i.lineItemId === lineItemId);
    if (!item || item.quantity === qty) continue;
    const line = findCalcLine(lines, item);
    if (!line) throw new EditRefused(`${item.title}: line not found on the Shopify order — reload and try again`);
    want.set(line.id, { line, to: Math.max(0, Math.round(qty)) });
  }

  // Additions: one call per variant, and a variant already on the order
  // grows that line (Shopify rejects it as a duplicate line otherwise).
  const added = new Map<string, AddStep>();
  for (const add of additions) {
    const existing = lines.find((l) => l.variantId === add.variantId && l.quantity > 0);
    if (existing) {
      const cur = want.get(existing.id)?.to ?? existing.quantity;
      want.set(existing.id, { line: existing, to: cur + 1 });
      continue;
    }
    const a = added.get(add.variantId);
    if (a) a.quantity += 1;
    else added.set(add.variantId, { variantId: add.variantId, title: add.title, quantity: 1 });
  }

  const setQuantities: QtyStep[] = [];
  for (const { line, to } of want.values()) {
    const fixed = line.quantity - line.editableQuantity;
    if (to < fixed) {
      throw new EditRefused(
        `${line.title}: ${fixed} already fulfilled — Shopify can't go below ${fixed}. Change the COD on the courier instead.`,
      );
    }
    if (to === line.quantity) continue;
    setQuantities.push({ calcLineId: line.id, title: line.title, from: line.quantity, to, editable: to - fixed });
  }
  return { setQuantities, addVariants: [...added.values()] };
}
