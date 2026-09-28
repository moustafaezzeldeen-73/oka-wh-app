import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, View } from 'react-native';

import {
  PERIOD_KEYS,
  REASON_LABEL,
  periodRange,
  type AnalyticsReport,
  type CarrierReport,
  type PeriodKey,
  type PlaceReport,
  type ReasonReport,
} from '../api/analytics';
import { loadAnalytics, type AnalyticsResult, type LoadStep } from '../api/analyticsLoader';
import { appSources, bostaDetailCache } from '../api/analyticsSources';
import { money, type CarrierKey } from '../api/model';
import { BackButton, Card, Mono, Txt } from '../components/primitives';
import type { Strings } from '../i18n/strings';
import { useApp } from '../state/AppState';
import { C, GUTTER, R } from '../theme/tokens';

type Loaded = AnalyticsResult & { at: Date };

// Reports survive leaving the screen; the refresh button reloads on demand.
const cache = new Map<PeriodKey, Loaded>();
let lastPeriod: PeriodKey = '30d';

const PERIOD_LABEL: Record<PeriodKey, keyof Strings> = {
  '7d': 'period7d',
  '14d': 'period14d',
  '30d': 'period30d',
  month: 'periodMonth',
  lastMonth: 'periodLastMonth',
};

const CARRIER_STYLE: Record<CarrierKey, { label: string; color: string }> = {
  jt: { label: 'J&T', color: C.red },
  bosta: { label: 'BOSTA', color: C.ink55 },
  inhouse: { label: 'OKA', color: C.greenDeep },
};

const pct = (x: number | null) => (x === null ? '—' : `${Math.round(x * 100)}%`);
const fill = (t: string, vars: Record<string, string | number>) =>
  Object.entries(vars).reduce((s, [k, v]) => s.split(`{${k}}`).join(String(v)), t);

/** Return rate → colour: the warehouse reads red as "act on this". */
const failColor = (rate: number | null) =>
  rate === null ? C.ink40 : rate >= 0.35 ? C.red : rate >= 0.2 ? C.amber : C.greenDeep;

export function AnalyticsScreen() {
  const { L, ar, go } = useApp();
  const [period, setPeriod] = useState<PeriodKey>(lastPeriod);
  const [shown, setShown] = useState<Loaded | null>(cache.get(lastPeriod) ?? null);
  const [progress, setProgress] = useState<{ step: LoadStep; done?: number; total?: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = useRef(0);

  const load = useCallback(async (p: PeriodKey, force: boolean) => {
    lastPeriod = p;
    const cached = cache.get(p);
    setShown(cached ?? null);
    if (cached && !force) {
      setProgress(null);
      setError(null);
      return;
    }
    const id = ++run.current;
    setError(null);
    setProgress({ step: 'shopify' });
    try {
      const { from, to } = periodRange(p);
      const result = await loadAnalytics(appSources, {
        from,
        to,
        bostaCache: bostaDetailCache,
        onProgress: (step, done, total) => {
          if (run.current === id) setProgress({ step, done, total });
        },
      });
      const loaded = { ...result, at: new Date() };
      cache.set(p, loaded);
      if (run.current === id) {
        setShown(loaded);
        setProgress(null);
      }
    } catch (e) {
      if (run.current === id) {
        setError(e instanceof Error ? e.message : String(e));
        setProgress(null);
      }
    }
  }, []);

  useEffect(() => {
    load(period, false);
  }, [period, load]);

  const report = shown?.report ?? null;

  return (
    <View style={{ flex: 1, minHeight: 0 }}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 12,
          paddingTop: 4,
          paddingHorizontal: GUTTER,
          paddingBottom: 12,
        }}
      >
        <BackButton onPress={() => go('modes')} ar={ar} />
        <Txt f="sansSemi" size={19} style={{ flex: 1 }}>
          {L.report}
        </Txt>
        <Pressable
          onPress={() => load(period, true)}
          disabled={progress !== null}
          hitSlop={8}
          style={({ pressed }) => ({
            width: 38,
            height: 38,
            borderRadius: 12,
            backgroundColor: C.ink06,
            alignItems: 'center',
            justifyContent: 'center',
            opacity: progress ? 0.4 : pressed ? 0.6 : 1,
          })}
        >
          <Mono size={17}>↻</Mono>
        </Pressable>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={{ flexGrow: 0 }}
        contentContainerStyle={{ paddingHorizontal: GUTTER, gap: 8, paddingBottom: 12 }}
      >
        {PERIOD_KEYS.map((k) => (
          <Pill key={k} label={L[PERIOD_LABEL[k]]} active={k === period} onPress={() => setPeriod(k)} />
        ))}
      </ScrollView>

      <ScrollView
        contentContainerStyle={{ paddingHorizontal: GUTTER, paddingBottom: 48, gap: 12 }}
        showsVerticalScrollIndicator={false}
      >
        {progress ? <ProgressCard L={L} progress={progress} /> : null}
        {error ? <ErrorCard L={L} message={error} onRetry={() => load(period, true)} /> : null}
        {report ? (
          <>
            <Headline L={L} report={report} />
            {report.stale.count > 0 ? <StaleCard L={L} report={report} /> : null}
            <MoneyCard L={L} report={report} />
            <FailedCostCard L={L} report={report} />
            {report.carriers.length ? <CouriersCard L={L} carriers={report.carriers} /> : null}
            <ReasonsCard L={L} ar={ar} report={report} />
            <PlacesCard L={L} ar={ar} report={report} />
            <Footer L={L} loaded={shown!} />
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function Pill({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        paddingHorizontal: 14,
        height: 34,
        borderRadius: R.pill,
        justifyContent: 'center',
        backgroundColor: active ? C.ink : C.surface,
        borderWidth: 1,
        borderColor: active ? C.ink : C.border,
        opacity: pressed ? 0.8 : 1,
      })}
    >
      <Txt f="sansMedium" size={13} color={active ? C.white : C.ink70}>
        {label}
      </Txt>
    </Pressable>
  );
}

function SectionTitle({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 12, gap: 8 }}>
      <Txt f="sansSemi" size={15} style={{ flex: 1 }}>
        {children}
      </Txt>
      {right}
    </View>
  );
}

function Toggle<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { key: T; label: string }[];
  value: T;
  onChange: (k: T) => void;
}) {
  return (
    <View style={{ flexDirection: 'row', backgroundColor: C.surfaceMuted, borderRadius: R.chipLg, padding: 3 }}>
      {options.map((o) => (
        <Pressable
          key={o.key}
          onPress={() => onChange(o.key)}
          style={{
            paddingHorizontal: 10,
            paddingVertical: 5,
            borderRadius: R.chip,
            backgroundColor: o.key === value ? C.surface : 'transparent',
          }}
        >
          <Txt f={o.key === value ? 'sansSemi' : 'sans'} size={11} color={o.key === value ? C.ink : C.ink50}>
            {o.label}
          </Txt>
        </Pressable>
      ))}
    </View>
  );
}

function Bar({ share, color }: { share: number; color: string }) {
  return (
    <View style={{ height: 6, borderRadius: 3, backgroundColor: C.ink06, overflow: 'hidden' }}>
      <View
        style={{
          width: `${Math.max(2, Math.min(100, Math.round(share * 100)))}%`,
          height: '100%',
          borderRadius: 3,
          backgroundColor: color,
        }}
      />
    </View>
  );
}

function ProgressCard({ L, progress }: { L: Strings; progress: { step: LoadStep; done?: number; total?: number } }) {
  const base = progress.step === 'shopify' ? L.reportShopify : progress.step === 'jt' ? L.reportJt : L.reportBosta;
  const count = progress.total ? ` (${progress.done ?? 0}/${progress.total})` : progress.step === 'shopify' ? '' : '…';
  return (
    <Card style={{ padding: 16, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
      <ActivityIndicator color={C.green} />
      <Txt size={13} color={C.ink60} style={{ flex: 1 }}>
        {base}
        {count}
      </Txt>
    </Card>
  );
}

function ErrorCard({ L, message, onRetry }: { L: Strings; message: string; onRetry: () => void }) {
  return (
    <Card style={{ padding: 16, borderColor: '#EBCACA', backgroundColor: '#F7EBEB' }}>
      <Txt f="sansSemi" size={14} color={C.red} style={{ marginBottom: 4 }}>
        {L.reportFailed}
      </Txt>
      <Txt size={12} lh={18} color={C.ink60} style={{ marginBottom: 12 }}>
        {message}
      </Txt>
      <Pressable onPress={onRetry} style={{ alignSelf: 'flex-start' }}>
        <Txt f="sansSemi" size={13} color={C.red}>
          {L.retry}
        </Txt>
      </Pressable>
    </Card>
  );
}

function Headline({ L, report }: { L: Strings; report: AnalyticsReport }) {
  const t = report.totals;
  return (
    <Card style={{ padding: 16, borderRadius: R.panel }}>
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <Kpi value={pct(t.deliveryRate)} label={L.deliveredRate} color={C.greenDeep} />
        <Kpi value={pct(t.failureRate)} label={L.failedRate} color={failColor(t.failureRate)} />
        <Kpi value={String(t.active)} label={L.onTheWay} color={C.ink} />
      </View>
      <Txt size={11} lh={17} color={C.ink45} style={{ marginTop: 12 }}>
        {fill(L.basedOn, { closed: t.closed, active: t.active, waiting: t.waiting, notShipped: report.notShipped })}
      </Txt>
      <View style={{ height: 1, backgroundColor: C.border, marginVertical: 12 }} />
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <View style={{ flex: 1 }}>
          <Mono size={17}>{pct(t.firstAttemptRate)}</Mono>
          <Txt size={11} color={C.ink45}>
            {L.firstAttempt}
          </Txt>
        </View>
        <View style={{ flex: 1 }}>
          <Mono size={17}>{t.avgAttempts === null ? '—' : t.avgAttempts.toFixed(1)}</Mono>
          <Txt size={11} color={C.ink45}>
            {L.avgAttempts}
          </Txt>
        </View>
      </View>
    </Card>
  );
}

function Kpi({ value, label, color }: { value: string; label: string; color: string }) {
  return (
    <View style={{ flex: 1 }}>
      <Mono size={28} color={color}>
        {value}
      </Mono>
      <Txt size={12} color={C.ink50} style={{ marginTop: 2 }}>
        {label}
      </Txt>
    </View>
  );
}

function StaleCard({ L, report }: { L: Strings; report: AnalyticsReport }) {
  const { stale } = report;
  return (
    <Card style={{ padding: 14, backgroundColor: '#F6EFE4', borderColor: '#EADBC2' }}>
      <Txt f="sansSemi" size={13} lh={20} color={C.amber}>
        {fill(L.staleTitle, { count: stale.count, days: stale.days })}
      </Txt>
      <Txt size={11} lh={17} color={C.ink55} style={{ marginTop: 2 }}>
        {L.staleHint}
      </Txt>
      <Mono f="monoMedium" size={11} lh={18} color={C.ink60} style={{ marginTop: 8 }}>
        {stale.orders.slice(0, 12).join('  ')}
        {stale.count > 12 ? '  …' : ''}
      </Mono>
    </Card>
  );
}

function MoneyRow({ label, value, sign, strong }: { label: string; value: number; sign: '+' | '−'; strong?: boolean }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 4 }}>
      <Txt size={13} color={strong ? C.white : C.onDark70} f={strong ? 'sansSemi' : 'sans'} style={{ flex: 1 }}>
        {label}
      </Txt>
      <Mono size={strong ? 15 : 13} color={strong ? C.white : C.onDark75}>
        {sign} {money(value)}
      </Mono>
    </View>
  );
}

function MoneyCard({ L, report }: { L: Strings; report: AnalyticsReport }) {
  const m = report.money;
  const ins: [string, number][] = [
    [L.codJt, m.in.jt],
    [L.codBosta, m.in.bosta],
    [L.cashInhouse, m.in.inhouse],
    [L.paidOnline, m.in.online],
  ];
  const outs: [string, number][] = [
    [L.feesJt, m.out.jt],
    [L.feesBosta, m.out.bosta],
    [L.costsInhouse, m.out.inhouse],
    [L.refunds, m.out.refunds],
  ];
  return (
    <View style={{ backgroundColor: C.ink, borderRadius: R.panel, padding: 18 }}>
      <Txt size={12} color={C.onDark60}>
        {L.balance}
      </Txt>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6, marginBottom: 14 }}>
        <Mono size={32} color={m.balance >= 0 ? C.white : C.recordText}>
          {m.balance < 0 ? '−' : ''}
          {money(Math.abs(m.balance))}
        </Mono>
        <Txt size={13} color={C.onDark60}>
          {L.egp}
        </Txt>
      </View>

      <Txt f="sansSemi" size={11} color={C.greenFlash} style={{ marginBottom: 2 }}>
        {L.moneyIn}
      </Txt>
      {ins.filter(([, v]) => v > 0).map(([label, v]) => (
        <MoneyRow key={label} label={label} value={v} sign="+" />
      ))}
      <MoneyRow label={L.moneyIn} value={m.in.total} sign="+" strong />

      <View style={{ height: 1, backgroundColor: C.onDark12, marginVertical: 10 }} />

      <Txt f="sansSemi" size={11} color={C.recordText} style={{ marginBottom: 2 }}>
        {L.moneyOut}
      </Txt>
      {outs.filter(([, v]) => v > 0).map(([label, v]) => (
        <MoneyRow key={label} label={label} value={v} sign="−" />
      ))}
      <MoneyRow label={L.moneyOut} value={m.out.total} sign="−" strong />

      {m.onTheRoad > 0 ? (
        <>
          <View style={{ height: 1, backgroundColor: C.onDark12, marginVertical: 10 }} />
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Txt size={12} color={C.onDark60} style={{ flex: 1 }}>
              {L.onTheRoad}
            </Txt>
            <Mono size={13} color={C.onDark75}>
              {money(m.onTheRoad)}
            </Mono>
          </View>
        </>
      ) : null}
      {m.estimated > 0 ? (
        <Txt size={11} lh={16} color={C.onDark50} style={{ marginTop: 8 }}>
          {fill(L.estimatedNote, { amount: money(m.estimated) })}
        </Txt>
      ) : null}
      {m.fromShopify > 0 ? (
        <Txt size={11} lh={16} color={C.onDark50} style={{ marginTop: 6 }}>
          {fill(L.fromShopifyNote, { amount: money(m.fromShopify) })}
        </Txt>
      ) : null}
    </View>
  );
}

function FailedCostCard({ L, report }: { L: Strings; report: AnalyticsReport }) {
  const f = report.failed;
  return (
    <Card style={{ padding: 16, borderRadius: R.panel }}>
      <SectionTitle>{L.failedCost}</SectionTitle>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6 }}>
        <Mono size={26} color={f.cost > 0 ? C.red : C.ink}>
          {money(f.cost)}
        </Mono>
        <Txt size={12} color={C.ink45}>
          {L.egp}
        </Txt>
      </View>
      <Txt size={12} color={C.ink50} style={{ marginTop: 4 }}>
        {f.count} {L.failedParcels}
        {f.avgCost !== null ? ` · ${money(f.avgCost)} ${L.perFailed}` : ''}
      </Txt>
      {f.uncollected > 0 ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 12 }}>
          <Txt size={12} color={C.ink60} style={{ flex: 1 }}>
            {L.uncollected}
          </Txt>
          <Mono size={13}>{money(f.uncollected)}</Mono>
        </View>
      ) : null}
    </Card>
  );
}

function CouriersCard({ L, carriers }: { L: Strings; carriers: CarrierReport[] }) {
  return (
    <Card style={{ padding: 16, borderRadius: R.panel }}>
      <SectionTitle>{L.couriers}</SectionTitle>
      {carriers.map((c, i) => {
        const s = CARRIER_STYLE[c.carrier];
        return (
          <View
            key={c.carrier}
            style={{
              paddingVertical: 10,
              borderTopWidth: i === 0 ? 0 : 1,
              borderTopColor: C.border,
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <View style={{ paddingHorizontal: 6, paddingVertical: 2, borderRadius: R.chip, borderWidth: 1, borderColor: s.color }}>
                <Mono f="monoMedium" size={10} color={s.color}>
                  {s.label}
                </Mono>
              </View>
              <Txt size={12} color={C.ink50} style={{ flex: 1 }}>
                {c.shipments} {L.shipments}
              </Txt>
              <Mono size={12} color={C.ink60}>
                {L.feesShort} {money(c.fees)}
              </Mono>
            </View>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <MiniStat value={pct(c.deliveryRate)} label={L.deliveredRate} color={C.greenDeep} />
              <MiniStat value={pct(c.failureRate)} label={L.failedRate} color={failColor(c.failureRate)} />
              <MiniStat
                value={money(c.net)}
                label={c.carrier === 'inhouse' ? L.netInhouse : L.netDue}
                color={c.net >= 0 ? C.ink : C.red}
              />
            </View>
          </View>
        );
      })}
    </Card>
  );
}

function MiniStat({ value, label, color }: { value: string; label: string; color: string }) {
  return (
    <View style={{ flex: 1 }}>
      <Mono size={16} color={color}>
        {value}
      </Mono>
      <Txt size={10} color={C.ink45}>
        {label}
      </Txt>
    </View>
  );
}

function ReasonsCard({ L, ar, report }: { L: Strings; ar: boolean; report: AnalyticsReport }) {
  const [mode, setMode] = useState<'final' | 'attempts'>('final');
  const list: ReasonReport[] = mode === 'final' ? report.reasons : report.attemptReasons;
  return (
    <Card style={{ padding: 16, borderRadius: R.panel }}>
      <SectionTitle
        right={
          <Toggle
            value={mode}
            onChange={setMode}
            options={[
              { key: 'final', label: L.finalReason },
              { key: 'attempts', label: L.allAttempts },
            ]}
          />
        }
      >
        {L.whyFail}
      </SectionTitle>
      {list.length === 0 ? (
        <Txt size={12} color={C.ink45}>
          {L.noFailures}
        </Txt>
      ) : (
        list.map((r) => (
          <View key={r.key} style={{ marginBottom: 12 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 5 }}>
              <Txt f="sansMedium" size={13} style={{ flex: 1 }}>
                {ar ? REASON_LABEL[r.key].ar : REASON_LABEL[r.key].en}
              </Txt>
              <Mono size={12} color={C.ink60}>
                {r.count} · {pct(r.share)}
              </Mono>
            </View>
            <Bar share={r.share} color={r.key === 'courier_error' ? C.amber : C.red} />
            {r.examples[0] ? (
              <Txt size={11} color={C.ink40} numberOfLines={1} style={{ marginTop: 4 }}>
                {r.examples[0].text}
              </Txt>
            ) : null}
          </View>
        ))
      )}
    </Card>
  );
}

function PlacesCard({ L, ar, report }: { L: Strings; ar: boolean; report: AnalyticsReport }) {
  const [mode, setMode] = useState<'gov' | 'area'>('gov');
  const [all, setAll] = useState(false);
  const list: PlaceReport[] = mode === 'gov' ? report.governorates : report.areas;
  const visible = all ? list : list.slice(0, 8);
  return (
    <Card style={{ padding: 16, borderRadius: R.panel }}>
      <SectionTitle
        right={
          <Toggle
            value={mode}
            onChange={(k) => {
              setMode(k);
              setAll(false);
            }}
            options={[
              { key: 'gov', label: L.governorates },
              { key: 'area', label: L.areas },
            ]}
          />
        }
      >
        {L.worstPlaces}
      </SectionTitle>
      {list.length === 0 ? (
        <Txt size={12} color={C.ink45}>
          {L.noPlaces}
        </Txt>
      ) : (
        <>
          {visible.map((p, i) => (
            <View key={p.key} style={{ flexDirection: 'row', gap: 10, marginBottom: 12 }}>
              <Mono f="monoMedium" size={12} color={C.ink40} style={{ width: 18 }}>
                {i + 1}
              </Mono>
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 5 }}>
                  <Txt f="sansMedium" size={13} numberOfLines={1} style={{ flex: 1 }}>
                    {ar ? p.ar : p.en}
                  </Txt>
                  <Mono size={13} color={failColor(p.failureRate)}>
                    {pct(p.failureRate)}
                  </Mono>
                </View>
                <Bar share={p.failureRate ?? 0} color={failColor(p.failureRate)} />
                <View style={{ flexDirection: 'row', marginTop: 4 }}>
                  <Txt size={11} color={C.ink45} style={{ flex: 1 }}>
                    {fill(L.failedOf, { failed: p.failed, closed: p.closed })}
                  </Txt>
                  {p.failedCost > 0 ? (
                    <Mono f="mono" size={11} color={C.ink45}>
                      −{money(p.failedCost)}
                    </Mono>
                  ) : null}
                </View>
              </View>
            </View>
          ))}
          {list.length > 8 ? (
            <Pressable onPress={() => setAll((a) => !a)} hitSlop={6}>
              <Txt f="sansSemi" size={12} color={C.greenDeep}>
                {all ? L.showLess : `${L.showAll} (${list.length})`}
              </Txt>
            </Pressable>
          ) : null}
          <Txt size={10} color={C.ink40} style={{ marginTop: 10 }}>
            {L.sortedHint}
          </Txt>
        </>
      )}
    </Card>
  );
}

function Footer({ L, loaded }: { L: Strings; loaded: Loaded }) {
  const hh = String(loaded.at.getHours()).padStart(2, '0');
  const mm = String(loaded.at.getMinutes()).padStart(2, '0');
  return (
    <View style={{ gap: 8 }}>
      {loaded.warnings.length ? (
        <View style={{ backgroundColor: '#F6EFE4', borderRadius: R.card, padding: 12 }}>
          <Txt size={11} lh={17} color={C.amber}>
            {L.notReadNote}
            {loaded.warnings.join(' · ')}
          </Txt>
        </View>
      ) : null}
      <Txt size={11} color={C.ink40} align="center">
        {fill(L.updatedAt, { time: `${hh}:${mm}` })}
      </Txt>
    </View>
  );
}
