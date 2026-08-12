import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { logActivity, makeEntry, appendActivity, type CallOutcome } from '../api/activity';
import {
  cancelDelivery,
  searchDeliveries,
  updateDelivery,
  updateDeliveryCod,
} from '../api/bosta';
import { isConfigured, missingConfig } from '../api/config';
import { uploadToShopify } from '../api/media';
import type { Order } from '../api/model';
import {
  fetchCatalog,
  loadOrders,
  reloadOrder,
  resolveScan,
  type CatalogProduct,
} from '../api/repository';
import {
  cancelShopifyOrder,
  orderEditAddVariant,
  orderEditBegin,
  orderEditCommit,
  orderEditSetQuantity,
  updateOrderNoteAndTags,
} from '../api/shopify';
import { stringsFor, type Lang, type Strings } from '../i18n/strings';

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

export type Sheet = 'wa' | 'call' | 'photo' | null;

/** Draft quantity/addition edits held before they are committed to Shopify. */
export type EditDraft = {
  /** lineItemId → new quantity */
  quantities: Record<string, number>;
  /** variants queued to be added */
  additions: { variantId: string; title: string; price: number; image: string | null }[];
  address: string | null;
};

const emptyDraft = (): EditDraft => ({ quantities: {}, additions: [], address: null });

type Ctx = {
  // config
  configured: boolean;
  configGaps: string[];

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
  logCall: (
    order: Order,
    args: {
      target: 'customer' | 'courier';
      phone: string;
      durationSec: number;
      outcome: CallOutcome;
      recordingUri: string | null;
    },
  ) => Promise<void>;
  logWhatsApp: (order: Order, title: string, body: string, phone: string) => Promise<void>;
  attachPhoto: (order: Order, uri: string) => Promise<void>;
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

  const [screen, setScreen] = useState<Screen>('list');
  const [sheet, setSheet] = useState<Sheet>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState(0);
  const [query, setQuery] = useState('');
  const [shipQuery, setShipQuery] = useState('');
  const [scanned, setScanned] = useState<string[]>([]);
  const [beep, setBeep] = useState(true);
  const [contactTarget, setContactTarget] = useState<'customer' | 'courier'>('customer');
  const [toast, setToast] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [draft, setDraft] = useState<EditDraft>(emptyDraft);

  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const configGaps = useMemo(() => missingConfig(), []);
  const configured = configGaps.length === 0;

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
        // Terminate the shipment first — a cancelled Shopify order with a live
        // Bosta parcel still on a truck is the expensive failure mode.
        if (order.bostaId) {
          try {
            await cancelDelivery(order.bostaId);
          } catch (err) {
            await logActivity(
              order.shopifyId,
              'cancel',
              `Bosta termination failed: ${err instanceof Error ? err.message : 'unknown'}`,
              { meta: { awb: order.awb } },
            );
            throw err;
          }
        }
        await cancelShopifyOrder(order.shopifyId);
        await logActivity(order.shopifyId, 'cancel', 'Order cancelled from the warehouse app', {
          meta: { awb: order.awb, bostaTerminated: Boolean(order.bostaId) },
        });
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

        // Keep Bosta's COD and address in step with the edited order.
        const totals = draftTotals(order);
        if (order.bostaId) {
          if (Math.round(totals.cod) !== Math.round(order.cod)) {
            try {
              await updateDeliveryCod(order.bostaId, Math.round(totals.cod));
              summary.push(`COD ${Math.round(order.cod)} → ${Math.round(totals.cod)} EGP`);
            } catch (err) {
              summary.push(
                `COD update refused by Bosta (${err instanceof Error ? err.message : 'unknown'})`,
              );
            }
          }
          if (addressChanged && draft.address) {
            try {
              await updateDelivery(order.bostaId, {
                dropOffAddress: { firstLine: draft.address },
              });
              summary.push(`Address → ${draft.address}`);
            } catch (err) {
              summary.push(
                `Address update refused by Bosta (${err instanceof Error ? err.message : 'unknown'})`,
              );
            }
          }
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

  const logCall = useCallback<Ctx['logCall']>(
    async (order, args) => {
      setBusy(args.recordingUri ? L.callUploading : L.syncing);
      try {
        let mediaUrl: string | null = null;
        if (args.recordingUri) {
          try {
            mediaUrl = await uploadToShopify(args.recordingUri, 'audio', {
              orderName: order.name,
              label: `call-${args.target}`,
            });
          } catch (err) {
            // Never lose the call record because the upload failed.
            mediaUrl = null;
            await logActivity(
              order.shopifyId,
              'note',
              `Call recording upload failed: ${err instanceof Error ? err.message : 'unknown'}`,
            );
          }
        }

        const who = args.target === 'courier' ? 'courier' : 'customer';
        const outcomeText: Record<CallOutcome, string> = {
          answered: 'answered — confirmed',
          noanswer: 'no answer',
          wrongnumber: 'wrong number',
          refused: 'refused the order',
        };

        await appendActivity(order.shopifyId, [
          makeEntry('call', `Call to ${who} ${args.phone} — ${outcomeText[args.outcome]}`, {
            durationSec: args.durationSec,
            outcome: args.outcome,
            mediaUrl: mediaUrl ?? undefined,
            meta: { awb: order.awb, target: args.target },
          }),
          ...(mediaUrl
            ? [
                makeEntry('recording', `Call recording attached (${args.durationSec}s)`, {
                  mediaUrl,
                  durationSec: args.durationSec,
                }),
              ]
            : []),
        ]);

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
        const url = await uploadToShopify(uri, 'image', {
          orderName: order.name,
          label: 'contents',
        });
        await logActivity(
          order.shopifyId,
          'photo',
          url ? 'Photo of order contents attached' : 'Photo captured (upload still processing)',
          { mediaUrl: url ?? undefined, meta: { awb: order.awb } },
        );
        showToast(L.photoSaved);
        await refreshOne(order.shopifyId);
      } catch (err) {
        showToast(`${L.saveFailed}: ${err instanceof Error ? err.message : ''}`.trim());
      } finally {
        setBusy(null);
      }
    },
    [L, refreshOne, showToast],
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
      logCall,
      logWhatsApp,
      attachPhoto,
      handleScan,
    }),
    [
      configured,
      configGaps,
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
      logCall,
      logWhatsApp,
      attachPhoto,
      handleScan,
    ],
  );

  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>;
}
