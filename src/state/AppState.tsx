import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { logActivity, makeEntry, appendActivity } from '../api/activity';
import { processCall, type CallArgs } from '../api/callProcessing';
import { cancelDelivery, updateDelivery, updateDeliveryCod } from '../api/bosta';
import { isConfigured, missingConfig, missingCouriers } from '../api/config';
import { buildPickInfo, cancelJtOrder, updateJtOrder } from '../api/jt';
import { uploadFile } from '../api/media';
import {
  CARRIER_NAME,
  TAG_DELIVERED,
  TAG_INHOUSE,
  itemsOf,
  shopifyCodOf,
  type CarrierKey,
  type Order,
  type OrderItem,
} from '../api/model';
import {
  fetchCatalog,
  loadOrders,
  reloadOrder,
  resolveScan,
  type CatalogProduct,
} from '../api/repository';
import {
  addOrderPhoto,
  cancelShopifyOrder,
  fetchOrderById,
  fulfillInHouse,
  markOrderPaid,
  setOrderMetafield,
  orderEditAddVariant,
  orderEditBegin,
  orderEditCommit,
  orderEditSetQuantity,
  updateOrderNoteAndTags,
} from '../api/shopify';
import { stringsFor, type Lang, type Strings } from '../i18n/strings';
import { isRerouted, truckRefusal } from './selectors';

export type Screen =
  | 'list'
  | 'scan'
  | 'detail'
  | 'edit'
  | 'track'
  | 'modes'
  | 'pickup'
  | 'shipstatus'
  | 'shipdetail';

export type Sheet = 'wa' | 'call' | 'photo' | 'deliver' | null;

/** Draft quantity/addition edits held before they are committed to Shopify. */
export type EditDraft = {
  /** lineItemId → new quantity */
  quantities: Record<string, number>;
  /** variants queued to be added */
  additions: { variantId: string; title: string; price: number; image: string | null }[];
  address: string | null;
};

const emptyDraft = (): EditDraft => ({ quantities: {}, additions: [], address: null });

/** The item list J&T prints on the label, priced after every discount. */
function jtPickInfo(items: OrderItem[], shipping: number, cod: number): string {
  const subtotal = items.reduce((s, i) => s + i.netUnitPrice * i.quantity, 0);
  return buildPickInfo(
    items.map((i) => ({ name: i.title, qty: i.quantity, unitPrice: i.netUnitPrice })),
    subtotal,
    shipping,
    cod,
  );
}

type Ctx = {
  // config
  configured: boolean;
  configGaps: string[];
  /** Couriers without keys, plus any courier that failed on the last load. */
  courierNotices: string[];

  // language
  lang: Lang;
  ar: boolean;
  L: Strings;
  setLang: (l: Lang) => void;

  // data
  orders: Order[];
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  catalog: CatalogProduct[];

  // navigation
  screen: Screen;
  go: (s: Screen) => void;
  sheet: Sheet;
  openSheet: (s: Sheet) => void;

  // selection
  selectedId: string | null;
  selected: Order | null;
  select: (shopifyId: string) => void;

  // list filtering
  filter: number;
  setFilter: (i: number) => void;
  query: string;
  setQuery: (q: string) => void;
  shipQuery: string;
  setShipQuery: (q: string) => void;

  // pickup mode
  /** Which truck is being loaded: a courier's pickup, or OKA's own delivery run. */
  truckCarrier: CarrierKey;
  setTruckCarrier: (c: CarrierKey) => void;
  /** Check one scanned order belongs on this truck, then log (and for in-house, tag) it. */
  loadOnTruck: (order: Order) => Promise<{ ok: true } | { ok: false; reason: string }>;
  resetScans: () => void;
  scanned: string[];
  beep: boolean;
  toggleBeep: () => void;
  pushScanned: (shopifyId: string) => void;
  undoScan: () => void;

  // contact target for call/WhatsApp sheets
  contactTarget: 'customer' | 'courier';
  setContactTarget: (t: 'customer' | 'courier') => void;

  // feedback
  toast: string | null;
  showToast: (msg: string) => void;
  busy: string | null;

  // edit draft
  draft: EditDraft;
  setQty: (lineItemId: string, qty: number) => void;
  addProduct: (p: CatalogProduct) => void;
  setDraftAddress: (a: string) => void;
  resetDraft: () => void;
  draftTotals: (order: Order) => { subtotal: number; cod: number; itemCount: number };

  // write actions — every one of these logs to the Shopify order
  markReady: (order: Order) => Promise<void>;
  cancelOrder: (order: Order) => Promise<void>;
  saveEdit: (order: Order) => Promise<void>;
  /** Push Shopify's balance to the courier when the two disagree. */
  syncCod: (order: Order) => Promise<void>;
  logCall: (order: Order, args: CallArgs) => Promise<void>;
  logWhatsApp: (order: Order, title: string, body: string, phone: string) => Promise<void>;
  /** Upload and attach; the result says why when it didn't save. */
  attachPhoto: (order: Order, uri: string) => Promise<{ ok: true } | { ok: false; error: string }>;
  /** In-house delivery done: records the cost, tags, logs, optionally marks paid. */
  markDelivered: (order: Order, opts: { cost: number; cashCollected: boolean }) => Promise<boolean>;
  handleScan: (code: string) => Promise<Order | null>;
};

const AppCtx = createContext<Ctx | null>(null);

export function useApp(): Ctx {
  const ctx = useContext(AppCtx);
  if (!ctx) throw new Error('useApp must be used inside <AppProvider>');
  return ctx;
}

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLang] = useState<Lang>('en');
  const ar = lang === 'ar';
  const L = useMemo(() => stringsFor(lang), [lang]);

  const [orders, setOrders] = useState<Order[]>([]);
  const [catalog, setCatalog] = useState<CatalogProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadWarnings, setLoadWarnings] = useState<string[]>([]);

  const [screen, setScreen] = useState<Screen>('list');
  const [sheet, setSheet] = useState<Sheet>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState(0);
  const [query, setQuery] = useState('');
  const [shipQuery, setShipQuery] = useState('');
  const [scanned, setScanned] = useState<string[]>([]);
  const [truckCarrier, setTruckCarrier] = useState<CarrierKey>('jt');
  const [beep, setBeep] = useState(true);
  const [contactTarget, setContactTarget] = useState<'customer' | 'courier'>('customer');
  const [toast, setToast] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [draft, setDraft] = useState<EditDraft>(emptyDraft);

  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const configGaps = useMemo(() => missingConfig(), []);
  const configured = configGaps.length === 0;
  const courierNotices = useMemo(
    () => [...missingCouriers().map((c) => `${c} — not configured`), ...loadWarnings],
    [loadWarnings],
  );

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2200);
  }, []);

  useEffect(
    () => () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    },
    [],
  );

  // ── loading ────────────────────────────────────────────────────────────────

  const load = useCallback(
    async (isRefresh: boolean) => {
      if (!isConfigured()) {
        setLoading(false);
        setError(null);
        return;
      }
      isRefresh ? setRefreshing(true) : setLoading(true);
      try {
        const res = await loadOrders({ ar });
        setOrders(res.orders);
        setLoadWarnings(res.warnings);
        setError(null);
        setSelectedId((cur) =>
          cur && res.orders.some((o) => o.shopifyId === cur)
            ? cur
            : (res.orders[0]?.shopifyId ?? null),
        );
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [ar],
  );

  useEffect(() => {
    void load(false);
    // Re-running on `ar` keeps Arabic/English city and address strings in sync.
  }, [load]);

  useEffect(() => {
    if (!isConfigured()) return;
    fetchCatalog(40)
      .then(setCatalog)
      .catch(() => setCatalog([]));
  }, []);

  const refresh = useCallback(() => load(true), [load]);

  /** Replace one order in the list after a write. */
  const patchOrder = useCallback((updated: Order) => {
    setOrders((prev) => prev.map((o) => (o.shopifyId === updated.shopifyId ? updated : o)));
  }, []);

  const refreshOne = useCallback(
    async (shopifyId: string) => {
      try {
        const fresh = await reloadOrder(shopifyId, ar);
        if (fresh) patchOrder(fresh);
      } catch {
        // The write already succeeded; a stale card is not worth an error toast.
      }
    },
    [ar, patchOrder],
  );

  const selected = useMemo(
    () => orders.find((o) => o.shopifyId === selectedId) ?? null,
    [orders, selectedId],
  );

  // ── navigation ─────────────────────────────────────────────────────────────

  const go = useCallback((s: Screen) => {
    setScreen(s);
    setSheet(null);
  }, []);

  const select = useCallback((shopifyId: string) => setSelectedId(shopifyId), []);
  const openSheet = useCallback((s: Sheet) => setSheet(s), []);

  // ── pickup mode ────────────────────────────────────────────────────────────

  const pushScanned = useCallback((shopifyId: string) => {
    setScanned((prev) => (prev.includes(shopifyId) ? prev : [...prev, shopifyId]));
  }, []);
  const undoScan = useCallback(() => setScanned((prev) => prev.slice(0, -1)), []);
  const resetScans = useCallback(() => setScanned([]), []);
  const toggleBeep = useCallback(() => setBeep((b) => !b), []);

  // ── edit draft ─────────────────────────────────────────────────────────────

  const setQty = useCallback((lineItemId: string, qty: number) => {
    setDraft((d) => ({ ...d, quantities: { ...d.quantities, [lineItemId]: Math.max(0, qty) } }));
  }, []);

  const addProduct = useCallback((p: CatalogProduct) => {
    setDraft((d) => ({
      ...d,
      additions: [
        ...d.additions,
        {
          variantId: p.variantId,
          title: p.title,
          price: parseFloat(p.price) || 0,
          image: p.image,
        },
      ],
    }));
  }, []);

  const setDraftAddress = useCallback((a: string) => setDraft((d) => ({ ...d, address: a })), []);
  const resetDraft = useCallback(() => setDraft(emptyDraft()), []);

  const draftTotals = useCallback(
    (order: Order) => {
      let subtotal = 0;
      let itemCount = 0;
      for (const it of order.items) {
        const q = draft.quantities[it.lineItemId] ?? it.quantity;
        subtotal += q * it.unitPrice;
        itemCount += q;
      }
      for (const add of draft.additions) {
        subtotal += add.price;
        itemCount += 1;
      }
      return { subtotal, cod: subtotal + order.shipping, itemCount };
    },
    [draft],
  );

  // ── write actions ──────────────────────────────────────────────────────────

  const markReady = useCallback(
    async (order: Order) => {
      setBusy(L.syncing);
      try {
        const tags = Array.from(new Set([...order.tags, 'oka-ready']));
        await updateOrderNoteAndTags(order.shopifyId, null, tags);
        await logActivity(order.shopifyId, 'status', 'Marked ready to load (warehouse app)', {
          meta: { awb: order.awb, phase: order.trackPhaseLabel.en },
        });
        showToast(ar ? 'الأوردر جاهز للتحميل' : 'Order marked ready');
        await refreshOne(order.shopifyId);
        go('list');
      } catch (err) {
        showToast(`${L.saveFailed}: ${err instanceof Error ? err.message : ''}`.trim());
      } finally {
        setBusy(null);
      }
    },
    [L, ar, go, refreshOne, showToast],
  );

  const cancelOrder = useCallback(
    async (order: Order) => {
      setBusy(L.syncing);
      try {
        // Cancel the shipment first — a cancelled Shopify order with a live
        // parcel still on a courier's truck is the expensive failure mode.
        let courierCancelled = false;
        if (order.awb && !order.bostaId && !order.jtOrder) {
          throw new Error(
            `${order.carrierName} shipment ${order.awb} could not be loaded — cancel it with ${order.carrierName} first`,
          );
        }
        try {
          if (order.bostaId) {
            await cancelDelivery(order.bostaId);
            courierCancelled = true;
          } else if (order.jtOrder) {
            await cancelJtOrder(order.jtOrder, 'Cancelled from OKA warehouse app');
            courierCancelled = true;
          }
        } catch (err) {
          await logActivity(
            order.shopifyId,
            'cancel',
            `${order.carrierName} cancellation failed: ${err instanceof Error ? err.message : 'unknown'}`,
            { meta: { awb: order.awb, carrier: order.carrier } },
          );
          throw err;
        }
        await cancelShopifyOrder(order.shopifyId);
        await logActivity(
          order.shopifyId,
          'cancel',
          courierCancelled
            ? `Order cancelled from the warehouse app; ${order.carrierName} shipment ${order.awb} cancelled`
            : 'Order cancelled from the warehouse app',
          { meta: { awb: order.awb, carrier: order.carrier, courierCancelled } },
        );
        showToast(L.orderCancelled);
        await refresh();
        go('list');
      } catch (err) {
        showToast(`${L.saveFailed}: ${err instanceof Error ? err.message : ''}`.trim());
      } finally {
        setBusy(null);
      }
    },
    [L, go, refresh, showToast],
  );

  const saveEdit = useCallback(
    async (order: Order) => {
      const changedQty = Object.entries(draft.quantities).filter(([id, qty]) => {
        const item = order.items.find((i) => i.lineItemId === id);
        return item && item.quantity !== qty;
      });
      const addressChanged =
        draft.address !== null && draft.address.trim() !== order.address.trim();

      if (changedQty.length === 0 && draft.additions.length === 0 && !addressChanged) {
        go('detail');
        return;
      }

      setBusy(L.syncing);
      try {
        const summary: string[] = [];

        if (changedQty.length > 0 || draft.additions.length > 0) {
          // A real Shopify order edit — Shopify records this on the timeline itself.
          const calc = await orderEditBegin(order.shopifyId);

          for (const [lineItemId, qty] of changedQty) {
            const item = order.items.find((i) => i.lineItemId === lineItemId);
            // Calculated line items carry their own ids; match on title+qty.
            const calcLine = calc.lineItems.nodes.find(
              (n) => n.title === item?.title && n.quantity === item?.quantity,
            );
            if (!calcLine) continue;
            await orderEditSetQuantity(calc.id, calcLine.id, qty);
            summary.push(`${item?.title}: ${item?.quantity} → ${qty}`);
          }

          for (const add of draft.additions) {
            await orderEditAddVariant(calc.id, add.variantId, 1);
            summary.push(`+ ${add.title}`);
          }

          await orderEditCommit(calc.id, `OKA Warehouse app: ${summary.join('; ')}`);
        }

        // Keep the courier's COD and address in step with the edited order.
        // Shopify's own recalculated balance is the new COD — it nets out
        // every discount, which the draft's list prices can't.
        const itemsEdited = changedQty.length > 0 || draft.additions.length > 0;
        let cod = Math.round(order.cod);
        let items: OrderItem[] = order.items;
        if (itemsEdited) {
          const fresh = await fetchOrderById(order.shopifyId).catch(() => null);
          cod = Math.round(fresh ? shopifyCodOf(fresh) : draftTotals(order).cod);
          if (fresh) items = itemsOf(fresh);
        }
        const codChanged = cod !== Math.round(order.cod);
        const refused = (what: string, err: unknown) =>
          summary.push(
            `${what} update refused by ${order.carrierName} (${err instanceof Error ? err.message : 'unknown'})`,
          );

        if (order.bostaId) {
          if (codChanged) {
            try {
              await updateDeliveryCod(order.bostaId, cod);
              summary.push(`COD ${Math.round(order.cod)} → ${cod} EGP`);
            } catch (err) {
              refused('COD', err);
            }
          }
          if (addressChanged && draft.address) {
            try {
              await updateDelivery(order.bostaId, {
                dropOffAddress: { firstLine: draft.address },
              });
              summary.push(`Address → ${draft.address}`);
            } catch (err) {
              refused('Address', err);
            }
          }
        } else if (order.jtOrder && (codChanged || itemsEdited || addressChanged)) {
          // J&T takes the whole order again; the label's item list is rebuilt
          // so the courier's invoice matches what is in the box.
          try {
            await updateJtOrder(order.jtOrder, order.name, {
              cod,
              street: addressChanged && draft.address ? draft.address : undefined,
              pickInfo: jtPickInfo(items, order.shipping, cod),
            });
            if (codChanged) summary.push(`COD ${Math.round(order.cod)} → ${cod} EGP`);
            if (addressChanged && draft.address) summary.push(`Address → ${draft.address}`);
            if (itemsEdited) summary.push('J&T invoice updated');
          } catch (err) {
            refused(addressChanged && !codChanged ? 'Address' : 'COD', err);
          }
        } else if (order.awb && (codChanged || addressChanged)) {
          summary.push(`${order.carrierName} not updated — shipment ${order.awb} could not be loaded`);
        }

        const entries = [makeEntry('edit', `Order edited — ${summary.join('; ')}`)];
        if (addressChanged && draft.address) {
          entries.push(
            makeEntry('address', `Delivery address updated to: ${draft.address}`, {
              meta: { previous: order.address },
            }),
          );
        }
        await appendActivity(order.shopifyId, entries);

        showToast(L.saved);
        resetDraft();
        await refreshOne(order.shopifyId);
        go('detail');
      } catch (err) {
        showToast(`${L.saveFailed}: ${err instanceof Error ? err.message : ''}`.trim());
      } finally {
        setBusy(null);
      }
    },
    [L, draft, draftTotals, go, refreshOne, resetDraft, showToast],
  );

  const syncCod = useCallback(
    async (order: Order) => {
      const mismatch = order.codMismatch;
      if (!mismatch) return;
      setBusy(L.syncing);
      try {
        const cod = Math.round(mismatch.shopify);
        if (order.bostaId) {
          await updateDeliveryCod(order.bostaId, cod);
        } else if (order.jtOrder) {
          await updateJtOrder(order.jtOrder, order.name, {
            cod,
            pickInfo: jtPickInfo(order.items, order.shipping, cod),
          });
        } else {
          throw new Error(`${order.carrierName} shipment ${order.awb ?? ''} could not be loaded`);
        }
        await logActivity(
          order.shopifyId,
          'edit',
          `${order.carrierName} COD ${Math.round(mismatch.courier)} → ${cod} EGP, matched to the Shopify balance`,
          { meta: { awb: order.awb, carrier: order.carrier } },
        );
        showToast(L.codSynced);
        await refreshOne(order.shopifyId);
      } catch (err) {
        showToast(`${L.saveFailed}: ${err instanceof Error ? err.message : ''}`.trim());
      } finally {
        setBusy(null);
      }
    },
    [L, refreshOne, showToast],
  );

  const logCall = useCallback<Ctx['logCall']>(
    async (order, args) => {
      setBusy(args.recording ? L.callUploading : L.syncing);
      try {
        const entries = await processCall(order, args, (stage) =>
          setBusy(stage === 'uploading' ? L.callUploading : L.syncing),
        );
        await appendActivity(order.shopifyId, entries);
        showToast(L.callLogged);
        await refreshOne(order.shopifyId);
      } catch (err) {
        showToast(`${L.saveFailed}: ${err instanceof Error ? err.message : ''}`.trim());
      } finally {
        setBusy(null);
      }
    },
    [L, refreshOne, showToast],
  );

  const logWhatsApp = useCallback<Ctx['logWhatsApp']>(
    async (order, title, body, phone) => {
      try {
        await logActivity(order.shopifyId, 'whatsapp', `WhatsApp to ${phone} — "${title}"`, {
          meta: { awb: order.awb, body },
        });
        await refreshOne(order.shopifyId);
      } catch {
        // The message was already sent; a failed log should not block the floor.
      }
    },
    [refreshOne],
  );

  const attachPhoto = useCallback<Ctx['attachPhoto']>(
    async (order, uri) => {
      setBusy(L.photoUploading);
      try {
        const { fileId, url } = await uploadFile(uri, 'image', {
          orderName: order.name,
          label: 'contents',
        });
        // The Warehouse photos field is what shows the image on the order page.
        let fieldNote = '';
        try {
          await addOrderPhoto(order.shopifyId, fileId);
        } catch (err) {
          fieldNote = ` (not added to the Warehouse photos field: ${err instanceof Error ? err.message : 'unknown'})`;
        }
        await logActivity(
          order.shopifyId,
          'photo',
          (url ? 'Photo of order contents attached' : 'Photo of order contents attached (still processing)') +
            fieldNote,
          { mediaUrl: url ?? undefined, meta: { awb: order.awb, fileId } },
        );
        showToast(L.photoSaved);
        await refreshOne(order.shopifyId);
        return { ok: true as const };
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        showToast(`${L.photoFailed}: ${error}`);
        return { ok: false as const, error };
      } finally {
        setBusy(null);
      }
    },
    [L, refreshOne, showToast],
  );

  const markDelivered = useCallback<Ctx['markDelivered']>(
    async (order, { cost, cashCollected }) => {
      setBusy(L.syncing);
      try {
        const notes: string[] = [];
        await setOrderMetafield(order.shopifyId, 'delivery_cost', String(cost), 'number_decimal');
        const tags = Array.from(new Set([...order.tags, TAG_INHOUSE, TAG_DELIVERED]));
        await updateOrderNoteAndTags(order.shopifyId, null, tags);
        if (cashCollected) {
          try {
            await markOrderPaid(order.shopifyId);
            notes.push(`cash ${Math.round(order.cod)} EGP collected, marked paid`);
          } catch (err) {
            notes.push(`could not mark paid: ${err instanceof Error ? err.message : 'unknown'}`);
          }
        }
        // Fulfilling needs fulfillment-order permissions the app may not have;
        // the delivery is recorded either way.
        try {
          const n = await fulfillInHouse(order.shopifyId);
          if (n > 0) notes.push('marked fulfilled in Shopify');
        } catch (err) {
          notes.push(`not marked fulfilled in Shopify: ${err instanceof Error ? err.message : 'unknown'}`);
        }
        await logActivity(
          order.shopifyId,
          'status',
          `Delivered by in-house courier — delivery cost ${cost} EGP${notes.length ? ` (${notes.join('; ')})` : ''}`,
          { meta: { carrier: 'inhouse', delivered: true, deliveryCost: cost, cashCollected } },
        );
        showToast(L.markedDelivered);
        await refreshOne(order.shopifyId);
        return true;
      } catch (err) {
        showToast(`${L.saveFailed}: ${err instanceof Error ? err.message : ''}`.trim());
        return false;
      } finally {
        setBusy(null);
      }
    },
    [L, refreshOne, showToast],
  );

  const loadOnTruck = useCallback<Ctx['loadOnTruck']>(
    async (order) => {
      const truck = truckCarrier;
      const reason = truckRefusal(order, truck, L);
      if (reason) return { ok: false, reason };
      const rerouted = isRerouted(order, truck);

      // Logged without blocking the next scan. In-house also tags the order so
      // it shows as out for delivery — except a rerouted courier parcel, which
      // only gets the note: its courier and AWB stay as they are.
      void (async () => {
        try {
          if (truck === 'inhouse' && !rerouted && !order.tags.some((t) => t.toLowerCase() === TAG_INHOUSE)) {
            await updateOrderNoteAndTags(order.shopifyId, null, [...order.tags, TAG_INHOUSE]);
          }
          await logActivity(
            order.shopifyId,
            'scan',
            rerouted
              ? `Rerouted: loaded on the in-house delivery truck with ${order.carrierName} AWB ${order.awb}`
              : truck === 'inhouse'
                ? 'Loaded on the in-house delivery truck — out for delivery'
                : `Loaded on the ${CARRIER_NAME[truck]} truck (pickup scan)`,
            {
              meta: rerouted
                ? { awb: order.awb, truck: 'inhouse', courier: order.carrier, rerouted: true }
                : { awb: order.awb, carrier: truck },
            },
          );
          if (truck === 'inhouse') await refreshOne(order.shopifyId);
        } catch (err) {
          showToast(`${L.saveFailed}: ${err instanceof Error ? err.message : ''}`.trim());
        }
      })();
      if (rerouted) showToast(L.reroutedNote.replace('{order}', order.name));
      return { ok: true };
    },
    [L, refreshOne, showToast, truckCarrier],
  );

  const handleScan = useCallback<Ctx['handleScan']>(
    async (code) => {
      try {
        const found = await resolveScan(code, orders, ar);
        if (!found) {
          showToast(L.scanNotFound);
          return null;
        }
        setOrders((prev) =>
          prev.some((o) => o.shopifyId === found.shopifyId)
            ? prev.map((o) => (o.shopifyId === found.shopifyId ? found : o))
            : [found, ...prev],
        );
        setSelectedId(found.shopifyId);
        return found;
      } catch (err) {
        showToast(err instanceof Error ? err.message : L.scanNotFound);
        return null;
      }
    },
    [L, ar, orders, showToast],
  );

  const value = useMemo<Ctx>(
    () => ({
      configured,
      configGaps,
      courierNotices,
      lang,
      ar,
      L,
      setLang,
      orders,
      loading,
      refreshing,
      error,
      refresh,
      catalog,
      screen,
      go,
      sheet,
      openSheet,
      selectedId,
      selected,
      select,
      filter,
      setFilter,
      query,
      setQuery,
      shipQuery,
      setShipQuery,
      truckCarrier,
      setTruckCarrier,
      loadOnTruck,
      resetScans,
      scanned,
      beep,
      toggleBeep,
      pushScanned,
      undoScan,
      contactTarget,
      setContactTarget,
      toast,
      showToast,
      busy,
      draft,
      setQty,
      addProduct,
      setDraftAddress,
      resetDraft,
      draftTotals,
      markReady,
      cancelOrder,
      saveEdit,
      syncCod,
      logCall,
      logWhatsApp,
      attachPhoto,
      markDelivered,
      handleScan,
    }),
    [
      configured,
      configGaps,
      courierNotices,
      lang,
      ar,
      L,
      orders,
      loading,
      refreshing,
      error,
      refresh,
      catalog,
      screen,
      go,
      sheet,
      openSheet,
      selectedId,
      selected,
      select,
      filter,
      query,
      shipQuery,
      truckCarrier,
      setTruckCarrier,
      loadOnTruck,
      resetScans,
      scanned,
      beep,
      toggleBeep,
      pushScanned,
      undoScan,
      contactTarget,
      toast,
      showToast,
      busy,
      draft,
      setQty,
      addProduct,
      setDraftAddress,
      resetDraft,
      draftTotals,
      markReady,
      cancelOrder,
      saveEdit,
      syncCod,
      logCall,
      logWhatsApp,
      attachPhoto,
      markDelivered,
      handleScan,
    ],
  );

  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>;
}
