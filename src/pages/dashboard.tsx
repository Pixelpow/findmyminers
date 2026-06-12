import { useState, useEffect, useMemo, useCallback } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import {
  TrendingUp,
  AlertCircle,
  AlertTriangle,
  Info,
  ArrowRight,
  Bot,
  Search,
  SlidersHorizontal,
  Radar,
  CheckCircle2,
  RefreshCw,
  ChevronUp,
  ChevronDown,
  Dices,
} from 'lucide-react';
import { buildFleetRecommendations, type AdvisorRecommendation } from '@/lib/advisor';
import { formatDiff, formatTime, fmtCompact } from '@/lib/format';
import { useSmartPolling, getPollCache, setPollCache } from '@/lib/use-smart-polling';
import { useToast } from '@/components/ToastProvider';
import { SmoothSpark, HealthGauge } from '@/components/nova-ui';

type FleetMiner = {
  id: string;
  name: string;
  model?: string;
  ip?: string;
  online: boolean;
  poolUrl?: string;
  protocol?: string;
  managedBy?: 'direct' | 'agent';
  latest?: {
    hashrateTHs?: number;
    tempAvg?: number;
    tempMax?: number;
    powerW?: number;
    poolAlive?: boolean;
    bestShare?: number;
    accepted?: number;
  } | null;
  stats?: {
    healthScore?: number;
    uptimeRatio?: number;
    avgHashrate24h?: number;
  } | null;
  fanRpm?: number;
  sparkline24h?: number[];
};

type FleetData = {
  fleet: FleetMiner[];
  totals: {
    miners: number;
    online: number;
    offline: number;
    hashrateTHs: number;
    powerW: number;
    avgTempC?: number;
  };
  nightModeActive?: boolean;
  vacationMode?: boolean;
};

type ProfitPayload = {
  totals?: { dailyNetEur?: number; monthlyNetEur?: number; dailyElecCostEur?: number; dailyGrossEur?: number };
  crypto?: { btcPriceEur?: number; btcPriceUsd?: number; difficulty?: number };
  config?: { elecCostEurKwh?: number; poolFeePct?: number };
};

type AlertEvent = {
  ts: number;
  type: string;
  minerId: string;
  minerName: string;
  message: string;
};

const FEED_TONES: Record<string, { label: string; chip: string; dot: string }> = {
  'pool-down': { label: 'POOL HS', chip: 'bg-rose-500/10 text-rose-400 border-rose-500/20', dot: 'bg-rose-500 dot-glow-rose' },
  thermal: { label: 'THERMIQUE', chip: 'bg-amber-500/10 text-amber-500 border-amber-500/20', dot: 'bg-amber-500 dot-glow-amber' },
  'hashrate-drop': { label: 'HASHRATE', chip: 'bg-amber-500/10 text-amber-500 border-amber-500/20', dot: 'bg-amber-500 dot-glow-amber' },
  anomaly: { label: 'ANOMALIE', chip: 'bg-btc-500/10 text-btc-500 border-btc-500/20', dot: 'bg-btc-500 dot-glow-btc' },
  maintenance: { label: 'MAINTENANCE', chip: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20', dot: 'bg-emerald-500 dot-glow-emerald' },
  'daily-report': { label: 'SYSTÈME', chip: 'bg-slate-500/10 text-slate-400 border-slate-500/20', dot: 'bg-slate-500' },
};

const fmtEur0 = (n?: number) =>
  n === undefined || Number.isNaN(n) ? '—' : `€${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

function poolHost(url: string): string {
  const match = url.match(/^(?:[a-z+]+:\/\/)?([^:/]+)/i);
  const host = match ? match[1] : url;
  return host.length > 20 ? `${host.slice(0, 18)}...` : host;
}

const FILTERS = ['all', 'online', 'issues'] as const;
type Filter = typeof FILTERS[number];

type SortKey = 'name' | 'hashrate' | 'temp' | 'power' | 'health';

/** Bouton de redémarrage à double clic (évite les accidents). */
function RebootButton({ miner, onReboot }: { miner: FleetMiner; onReboot: (m: FleetMiner) => Promise<void> }) {
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (busy) return;
    if (!confirm) {
      setConfirm(true);
      setTimeout(() => setConfirm(false), 3000);
      return;
    }
    setConfirm(false);
    setBusy(true);
    void onReboot(miner).finally(() => setBusy(false));
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={busy}
      title={confirm ? 'Clique pour confirmer le redémarrage' : 'Redémarrer ce mineur'}
      aria-label={`Redémarrer ${miner.name}`}
      className={`focus-ring p-1 rounded transition-all ${
        confirm
          ? 'text-rose-400 bg-rose-500/10 border border-rose-500/30 opacity-100'
          : 'text-slate-500 hover:text-white opacity-0 group-hover:opacity-100'
      }`}
    >
      <RefreshCw className={`w-3.5 h-3.5 ${busy ? 'animate-spin' : ''}`} />
    </button>
  );
}

export default function DashboardPage() {
  const router = useRouter();
  const { toast } = useToast();
  const [profit, setProfit] = useState<ProfitPayload | null>(() => getPollCache<ProfitPayload>('profitability'));
  const [feed, setFeed] = useState<AlertEvent[]>(() => getPollCache<AlertEvent[]>('alerts-feed') ?? []);
  const [feedLoaded, setFeedLoaded] = useState(() => getPollCache('alerts-feed') !== null);
  const [scanning, setScanning] = useState(false);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const fetchFleet = useCallback(async () => {
    const res = await fetch('/api/miner/fleet');
    if (!res.ok) throw new Error('Fleet fetch failed');
    return await res.json() as FleetData;
  }, []);

  // cacheKey 'fleet' renders the last known data instantly when navigating
  // back to this tab; the poll then refreshes it in the background.
  const { data: fleetData, refetch } = useSmartPolling(fetchFleet, { intervalMs: 3_000, cacheKey: 'fleet' });
  const loading = !fleetData;

  // Profitability (60s)
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch('/api/miner/profitability');
        if (!res.ok) return;
        const json = await res.json();
        setPollCache('profitability', json);
        if (!cancelled) setProfit(json);
      } catch { /* ignore */ }
    };
    void load();
    const t = setInterval(load, 60_000);
    return () => { cancelled = true; clearInterval(t); };
  }, []);

  // Live feed (60s)
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch('/api/alerts/history?limit=12');
        if (!res.ok) return;
        const json = await res.json();
        setPollCache('alerts-feed', (json.events || []) as AlertEvent[]);
        if (!cancelled) {
          setFeed((json.events || []) as AlertEvent[]);
          setFeedLoaded(true);
        }
      } catch { /* ignore */ }
    };
    void load();
    const t = setInterval(load, 60_000);
    return () => { cancelled = true; clearInterval(t); };
  }, []);

  // Keyboard shortcut refresh (R)
  useEffect(() => {
    const handler = () => { void refetch(); };
    window.addEventListener('app:refresh', handler);
    return () => window.removeEventListener('app:refresh', handler);
  }, [refetch]);

  const runScan = async () => {
    if (scanning) return;
    setScanning(true);
    try {
      const res = await fetch('/api/miner/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ autoAdd: true }),
      });
      if (!res.ok) return;
      const data = await res.json();
      toast('success', `${data.discovered} mineur${data.discovered !== 1 ? 's' : ''} trouvé${data.discovered !== 1 ? 's' : ''}${data.added ? ` · ${data.added} ajouté${data.added !== 1 ? 's' : ''}` : ''}`);
      await refetch();
    } catch { /* ignore */ }
    finally { setScanning(false); }
  };

  const fleet = useMemo(() => fleetData?.fleet ?? [], [fleetData]);
  const totals = fleetData?.totals;
  const total = totals?.miners || 0;
  const online = totals?.online || 0;
  const offline = Math.max(0, total - online);
  const avgTemp = totals?.avgTempC || 0;
  const powerW = totals?.powerW || 0;

  const recommendations = useMemo(() => buildFleetRecommendations(fleet, total), [fleet, total]);
  const criticalCount = offline + recommendations.filter((r) => r.severity === 'critical').length;
  const warningCount = recommendations.filter((r) => r.severity === 'warning').length;
  const alertsCount = criticalCount + warningCount;

  // Aggregate fleet hashrate sparkline (sum per normalized index)
  const fleetSpark = useMemo(() => {
    const arrays = fleet.map((m) => m.sparkline24h || []).filter((a) => a.length > 1);
    if (!arrays.length) return [];
    const len = Math.max(...arrays.map((a) => a.length));
    return Array.from({ length: len }, (_, i) =>
      arrays.reduce((sum, a) => sum + (a[Math.min(a.length - 1, Math.floor((i / len) * a.length))] || 0), 0),
    );
  }, [fleet]);

  const sparkAvg = fleetSpark.length ? fleetSpark.reduce((s, v) => s + v, 0) / fleetSpark.length : 0;
  const sparkPeak = fleetSpark.length ? Math.max(...fleetSpark) : 0;
  const sparkDip = fleetSpark.length ? Math.min(...fleetSpark) : 0;

  // Probabilité de trouver au moins un bloc (processus de Poisson) :
  // λ = hashrate / (difficulté × 2^32) blocs/s, P(T) = 1 − e^(−λT).
  const blockOdds = useMemo(() => {
    const hashrateTHs = totals?.hashrateTHs || 0;
    const difficulty = profit?.crypto?.difficulty || 0;
    if (hashrateTHs <= 0 || difficulty <= 0) return null;
    const lambdaPerSec = (hashrateTHs * 1e12) / (difficulty * 2 ** 32);
    const horizons = [
      { label: '24 heures', seconds: 86_400 },
      { label: '30 jours', seconds: 30 * 86_400 },
      { label: '1 an', seconds: 365.25 * 86_400 },
      { label: '5 ans', seconds: 5 * 365.25 * 86_400 },
      { label: '10 ans', seconds: 10 * 365.25 * 86_400 },
    ].map((h) => ({ ...h, p: 1 - Math.exp(-lambdaPerSec * h.seconds) }));
    const expectedYears = 1 / (lambdaPerSec * 365.25 * 86_400);
    return { horizons, expectedYears, maxP: horizons[horizons.length - 1].p };
  }, [totals?.hashrateTHs, profit?.crypto?.difficulty]);

  const fmtOdds = (p: number) => {
    if (p >= 0.01) return `${(p * 100).toFixed(1)} %`;
    if (p >= 0.0001) return `${(p * 100).toFixed(3)} %`;
    return `1 sur ${fmtCompact(Math.round(1 / p))}`;
  };

  const elecCostHour = powerW > 0 && profit?.config?.elecCostEurKwh !== undefined
    ? (powerW / 1000) * profit.config.elecCostEurKwh
    : null;
  const netDaily = profit?.totals?.dailyNetEur;
  const grossDaily = profit?.totals?.dailyGrossEur
    ?? (netDaily !== undefined ? netDaily + (profit?.totals?.dailyElecCostEur || 0) : undefined);

  // Lignes du tableau : filtre + recherche, puis tri choisi (ou problèmes d'abord par défaut)
  const visibleFleet = useMemo(() => {
    const temp = (m: FleetMiner) => m.latest?.tempMax ?? m.latest?.tempAvg ?? 0;
    let list = filter === 'online' ? fleet.filter((m) => m.online)
      : filter === 'issues' ? fleet.filter((m) => !m.online || temp(m) >= 85)
      : fleet;
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter((m) =>
        m.name.toLowerCase().includes(q)
        || (m.model || '').toLowerCase().includes(q)
        || (m.ip || '').toLowerCase().includes(q));
    }
    if (sortKey) {
      const value = (m: FleetMiner): number | string => {
        switch (sortKey) {
          case 'name': return m.name.toLowerCase();
          case 'hashrate': return m.latest?.hashrateTHs || 0;
          case 'temp': return m.latest?.tempAvg || 0;
          case 'power': return m.latest?.powerW || 0;
          case 'health': return m.stats?.healthScore || 0;
        }
      };
      return [...list].sort((a, b) => {
        const av = value(a);
        const bv = value(b);
        const cmp = av < bv ? -1 : av > bv ? 1 : 0;
        return sortDir === 'asc' ? cmp : -cmp;
      });
    }
    return [...list].sort((a, b) => {
      if (a.online !== b.online) return a.online ? 1 : -1;
      return (a.stats?.healthScore ?? 100) - (b.stats?.healthScore ?? 100);
    });
  }, [fleet, filter, search, sortKey, sortDir]);

  const cycleFilter = () => setFilter((f) => FILTERS[(FILTERS.indexOf(f) + 1) % FILTERS.length]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      // asc après desc, puis retour au tri par défaut (problèmes d'abord)
      if (sortDir === 'desc') { setSortDir('asc'); return; }
      setSortKey(null);
      setSortDir('desc');
      return;
    }
    setSortKey(key);
    setSortDir(key === 'name' ? 'asc' : 'desc');
  };

  const handleReboot = useCallback(async (miner: FleetMiner) => {
    try {
      const res = await fetch('/api/miner/control', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reboot', minerId: miner.id }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.error || 'Redémarrage refusé');
      toast('success', `Redémarrage demandé · ${miner.name}`);
    } catch (e) {
      toast('error', e instanceof Error ? e.message : 'Redémarrage échoué');
    }
  }, [toast]);

  const advisorTone = (severity: AdvisorRecommendation['severity']) => {
    if (severity === 'critical') return {
      wrap: 'bg-rose-500/5 border-rose-500/10',
      action: 'text-rose-400 hover:text-rose-300',
      icon: <AlertCircle className="w-[18px] h-[18px] text-rose-500 shrink-0 mt-0.5" fill="currentColor" stroke="#0a0a0c" />,
    };
    if (severity === 'warning') return {
      wrap: 'bg-amber-500/5 border-amber-500/10',
      action: 'text-amber-400 hover:text-amber-300',
      icon: <AlertTriangle className="w-[18px] h-[18px] text-amber-500 shrink-0 mt-0.5" fill="currentColor" stroke="#0a0a0c" />,
    };
    return {
      wrap: 'bg-blue-500/5 border-blue-500/10',
      action: 'text-blue-400 hover:text-blue-300',
      icon: <Info className="w-[18px] h-[18px] text-blue-500 shrink-0 mt-0.5" fill="currentColor" stroke="#0a0a0c" />,
    };
  };

  return (
    <>
      <Head>
        <title>Tableau de bord · FindMyMiners</title>
      </Head>

      {/* Global SVG Gradients for Sparklines */}
      <svg style={{ width: 0, height: 0, position: 'absolute' }} aria-hidden="true" focusable="false">
        <defs>
          <linearGradient id="sparkline-gradient" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#FF9900" stopOpacity="0.3" />
            <stop offset="100%" stopColor="#FF9900" stopOpacity="0" />
          </linearGradient>
        </defs>
      </svg>

      <div className="space-y-8">

      {/* Rangée KPI */}
      <section className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-5">

        {/* Active Fleet */}
        <div className="nova-glass p-5 flex flex-col justify-between group transition-transform hover:-translate-y-[1px]">
          <div className="text-[10px] uppercase tracking-widest text-slate-400 font-semibold mb-4">Flotte active</div>
          <div className="font-mono text-3xl text-slate-100 font-bold tracking-tight">{loading ? '—' : total.toLocaleString()}</div>
          <div className={`text-[11px] font-mono mt-2 flex items-center gap-1 ${offline > 0 ? 'text-amber-400' : 'text-emerald-400'}`}>
            <TrendingUp className="w-3 h-3" strokeWidth={3} />
            <span>{loading ? '· · ·' : `${online} en ligne`}</span>
          </div>
        </div>

        {/* Hashrate */}
        <div className="nova-glass p-5 flex flex-col justify-between group transition-transform hover:-translate-y-[1px]">
          <div className="text-[10px] uppercase tracking-widest text-slate-400 font-semibold mb-4">Hashrate</div>
          <div className="font-mono text-3xl text-slate-100 font-bold tracking-tight flex items-baseline gap-1">
            {loading ? '—' : (totals?.hashrateTHs || 0).toFixed(1)} <span className="text-xs text-slate-500 font-sans tracking-normal">TH/s</span>
          </div>
          <div className="h-6 w-full mt-2 relative">
            {fleetSpark.length > 1 ? (
              <>
                <SmoothSpark data={fleetSpark} width={100} height={24} />
                <div className="absolute inset-0 flex items-end opacity-0 group-hover:opacity-100 transition-opacity">
                  <span className="text-[10px] font-mono text-btc-500 bg-obsidian-950/80 px-1 rounded backdrop-blur">{sparkAvg.toFixed(1)} moy.</span>
                </div>
              </>
            ) : (
              <svg viewBox="0 0 100 24" preserveAspectRatio="none" className="w-full h-full">
                <line x1="0" y1="20" x2="100" y2="20" className="nova-sparkline-stroke-dim" />
              </svg>
            )}
          </div>
        </div>

        {/* Power */}
        <div className="nova-glass p-5 flex flex-col justify-between group transition-transform hover:-translate-y-[1px]">
          <div className="text-[10px] uppercase tracking-widest text-slate-400 font-semibold mb-4">Conso totale</div>
          <div className="font-mono text-3xl text-slate-100 font-bold tracking-tight flex items-baseline gap-1">
            {loading ? '—' : powerW >= 10_000 ? (powerW / 1000).toFixed(2) : powerW.toFixed(0)}
            <span className="text-xs text-slate-500 font-sans tracking-normal">{powerW >= 10_000 ? 'kW' : 'W'}</span>
          </div>
          <div className="text-[11px] font-mono text-slate-400 mt-3">
            {elecCostHour !== null ? `Coût : €${elecCostHour.toFixed(2)} / h` : 'Coût : —'}
          </div>
        </div>

        {/* Avg Temp */}
        <div className="nova-glass p-5 flex flex-col justify-between group transition-transform hover:-translate-y-[1px]">
          <div className="text-[10px] uppercase tracking-widest text-slate-400 font-semibold mb-4">Temp moyenne</div>
          <div className={`font-mono text-3xl font-bold tracking-tight flex items-baseline gap-1 ${
            avgTemp >= 85 ? 'text-rose-500 glow-rose' : avgTemp >= 70 ? 'text-amber-400 glow-amber' : 'text-slate-100'
          }`}>
            {loading || avgTemp <= 0 ? '—' : avgTemp.toFixed(1)} <span className="text-xs font-sans tracking-normal">°C</span>
          </div>
          <div className="text-[11px] font-mono text-slate-500 mt-3">
            Cible &lt; 70°C
          </div>
        </div>

        {/* Daily Profit */}
        <div className="nova-glass p-5 flex flex-col justify-between group transition-transform hover:-translate-y-[1px]">
          <div className="text-[10px] uppercase tracking-widest text-btc-500 font-semibold mb-4">Brut / jour</div>
          <div className="font-mono text-3xl text-slate-100 font-bold tracking-tight">{fmtEur0(grossDaily)}</div>
          <div className="text-[11px] font-mono text-slate-400 mt-3 pt-1 border-t border-white/5">
            Net proj. : {netDaily !== undefined ? `${fmtEur0(netDaily)} / jour` : '—'}
          </div>
        </div>

        {/* Active Alerts */}
        <div className="nova-glass p-5 flex flex-col justify-between group transition-transform hover:-translate-y-[1px]">
          <div className="text-[10px] uppercase tracking-widest text-slate-400 font-semibold mb-4">Alertes actives</div>
          <div className="font-mono text-3xl text-slate-100 font-bold tracking-tight">{loading ? '—' : alertsCount}</div>
          <div className="flex items-center gap-2 mt-2">
            <span className="text-[10px] font-mono bg-rose-500/10 text-rose-500 px-1.5 py-0.5 rounded border border-rose-500/20">{criticalCount} Crit.</span>
            <span className="text-[10px] font-mono bg-amber-500/10 text-amber-500 px-1.5 py-0.5 rounded border border-amber-500/20">{warningCount} Avert.</span>
          </div>
        </div>

      </section>

      {/* Grille principale */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-8">

        {/* Center Fleet Table */}
        <div className="xl:col-span-8 nova-glass flex flex-col overflow-hidden relative min-h-[500px]">

          {/* Table Toolbar */}
          <div className="h-16 flex items-center justify-between px-6 border-b border-white/5 bg-white/[0.01] shrink-0">
            <div className="flex items-center gap-3 min-w-0">
              <h2 className="text-sm font-semibold text-slate-200 shrink-0">Mineurs actifs</h2>
              {fleetData?.nightModeActive && (
                <span className="text-[9px] font-mono font-semibold border px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400 border-blue-500/20" title="Le planning nuit (ventilation / mode réduit) est actuellement appliqué">
                  🌙 MODE NUIT
                </span>
              )}
              {fleetData?.vacationMode && (
                <span className="text-[9px] font-mono font-semibold border px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-500 border-amber-500/20" title="Mode vacances : l'auto-reboot et les automatismes sont suspendus">
                  ✈ VACANCES
                </span>
              )}
            </div>
            <div className="flex items-center gap-3">
              <div className="relative">
                <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Rechercher un mineur..."
                  className="focus-ring bg-obsidian-950 border border-white/10 rounded-md py-1 pl-8 pr-3 text-xs text-slate-200 w-48 md:w-64 placeholder:text-slate-600"
                />
              </div>
              <button
                type="button"
                onClick={cycleFilter}
                className={`focus-ring p-1.5 rounded border transition-colors ${
                  filter === 'all'
                    ? 'bg-white/5 border-white/10 text-slate-400 hover:text-white hover:bg-white/10'
                    : 'bg-btc-500/10 border-btc-500/30 text-btc-500'
                }`}
                aria-label="Changer de filtre"
                title={`Filtre : ${filter === 'all' ? 'tous' : filter === 'online' ? 'en ligne' : 'problèmes'}`}
              >
                <SlidersHorizontal className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Table Container (Scrollable) */}
          <div className="flex-1 overflow-auto relative max-h-[640px]">
            <table className="nova-table w-full text-left font-mono text-xs whitespace-nowrap">
              <thead className="text-[10px] uppercase tracking-wider text-slate-500 sticky top-0 z-10">
                <tr>
                  <th className="py-4 px-5 w-10 font-semibold">St</th>
                  {([
                    ['name', 'Mineur / Modèle', ''],
                    [null, 'Pool', ''],
                    ['hashrate', 'Hashrate', 'text-right'],
                    ['temp', 'Temp', 'text-right'],
                    ['power', 'Conso', 'text-right'],
                    [null, 'RPM', 'text-right'],
                    [null, 'Diff', 'text-right'],
                    ['health', 'Santé', 'text-center'],
                  ] as [SortKey | null, string, string][]).map(([key, label, align]) => (
                    <th key={label} className={`py-4 px-5 font-semibold ${align}`}>
                      {key ? (
                        <button
                          type="button"
                          onClick={() => toggleSort(key)}
                          className={`focus-ring inline-flex items-center gap-1 uppercase tracking-wider transition-colors ${sortKey === key ? 'text-slate-200' : 'hover:text-slate-300'}`}
                        >
                          {label}
                          {sortKey === key
                            ? (sortDir === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />)
                            : <ChevronUp className="w-3 h-3 opacity-25" />}
                        </button>
                      ) : label}
                    </th>
                  ))}
                  <th className="py-4 px-5 font-semibold text-center w-10">Act</th>
                </tr>
              </thead>

              {loading ? (
                <tbody className="divide-y divide-white/[0.03]">
                  {[0, 1, 2, 3].map((i) => (
                    <tr key={i} className="nova-shimmer">
                      <td className="py-4 px-4" colSpan={10}>
                        <div className={`h-4 bg-white/5 rounded ${i === 1 ? 'w-11/12' : i === 3 ? 'w-10/12' : 'w-full'}`} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              ) : total === 0 ? (
                <tbody>
                  <tr>
                    <td colSpan={10} className="py-24 text-center">
                      <div className="inline-flex items-center justify-center w-12 h-12 rounded-full border border-dashed border-slate-600 mb-4 bg-obsidian-950">
                        <Radar className="w-5 h-5 text-slate-500" />
                      </div>
                      <h3 className="text-slate-300 font-sans font-semibold mb-1 text-sm">Aucun mineur détecté</h3>
                      <p className="text-slate-500 font-sans text-xs mb-4">Lance un scan réseau pour peupler la flotte.</p>
                      <button
                        type="button"
                        onClick={runScan}
                        disabled={scanning}
                        className="focus-ring bg-white text-obsidian-950 font-sans font-semibold text-xs px-4 py-2 rounded shadow hover:bg-slate-200 transition-colors active:scale-95 disabled:opacity-60"
                      >
                        {scanning ? 'Scan du réseau...' : 'Lancer un scan réseau'}
                      </button>
                    </td>
                  </tr>
                </tbody>
              ) : (
                <tbody className="divide-y divide-white/[0.03]">
                  {visibleFleet.length === 0 && (
                    <tr>
                      <td colSpan={10} className="py-12 text-center text-slate-500 font-sans text-xs">
                        Aucun mineur ne correspond à ce filtre.
                      </td>
                    </tr>
                  )}
                  {visibleFleet.map((miner) => {
                    const temp = miner.latest?.tempAvg || 0;
                    const hr = miner.latest?.hashrateTHs || 0;
                    const baseline = miner.stats?.avgHashrate24h || 0;
                    const ratio = baseline > 0 ? Math.min(100, Math.round((hr / baseline) * 100)) : (hr > 0 ? 100 : 0);
                    const health = miner.stats?.healthScore || 0;
                    const power = miner.latest?.powerW || 0;
                    const rpm = miner.fanRpm || 0;
                    const diff = miner.latest?.bestShare || 0;
                    const poolAlive = miner.online && (miner.latest?.poolAlive ?? true);
                    const warn = miner.online && (temp >= 80 || (health > 0 && health < 60));
                    const tempTone = !miner.online ? 'text-slate-500'
                      : temp >= 85 ? 'font-bold text-rose-500'
                      : temp >= 75 ? 'text-amber-400'
                      : 'text-emerald-400';
                    const barTone = warn ? 'bg-amber-400' : 'bg-emerald-400';
                    const hrTone = !miner.online ? 'text-slate-500' : warn ? 'text-amber-400' : 'text-slate-200';

                    return (
                      <tr
                        key={miner.id}
                        onClick={() => router.push(`/miners/${miner.id}`)}
                        className={`hover:bg-white/[0.02] transition-colors group cursor-pointer ${!miner.online ? 'opacity-60 bg-white/[0.01]' : ''}`}
                      >
                        <td className="py-4 px-5">
                          <div className={`w-1.5 h-1.5 rounded-full ${
                            !miner.online ? 'bg-slate-600'
                            : warn ? 'bg-amber-500 dot-glow-amber'
                            : 'bg-emerald-500 dot-glow-emerald'
                          }`} />
                        </td>
                        <td className={`py-4 px-5 ${!miner.online ? 'text-slate-500' : ''}`}>
                          <div className={`font-medium font-sans flex items-center gap-2 ${miner.online ? 'text-slate-200' : ''}`}>
                            {miner.name}
                            {!miner.online && (
                              <span className="bg-rose-500/10 text-rose-500 text-[9px] px-1 rounded border border-rose-500/20">PANNE</span>
                            )}
                          </div>
                          <div className="text-[10px] text-slate-500">{miner.model || 'Modèle inconnu'}</div>
                        </td>
                        <td className="py-4 px-5">
                          <div className="flex items-center gap-1.5">
                            <div className={`w-1 h-1 rounded-full ${poolAlive ? 'bg-emerald-500' : 'bg-rose-500'}`} />
                            {poolAlive ? (
                              <span className="text-slate-400">{miner.poolUrl ? poolHost(miner.poolUrl) : '—'}</span>
                            ) : (
                              <span className="text-rose-400">pool injoignable</span>
                            )}
                          </div>
                        </td>
                        <td className="py-4 px-5 text-right">
                          <div className={`flex items-center justify-end gap-2 ${hrTone}`}>
                            <span>{hr.toFixed(1)}</span>
                            {miner.online ? (
                              <div className="w-10 h-1 bg-white/10 rounded-full overflow-hidden flex-shrink-0" title={`${ratio}% de la baseline`}>
                                <div className={`h-full ${barTone}`} style={{ width: `${ratio}%` }} />
                              </div>
                            ) : (
                              <div className="w-10 h-1 rounded-full overflow-hidden flex-shrink-0 flex items-center">
                                <svg viewBox="0 0 10 1" className="w-full h-full" preserveAspectRatio="none">
                                  <line x1="0" y1="0.5" x2="10" y2="0.5" className="nova-sparkline-stroke-dim" strokeWidth="2" />
                                </svg>
                              </div>
                            )}
                          </div>
                        </td>
                        <td className={`py-4 px-5 text-right ${tempTone}`}>{temp > 0 ? `${temp.toFixed(0)}°C` : '—'}</td>
                        <td className={`py-4 px-5 text-right ${!miner.online ? 'text-slate-500' : 'text-slate-400'}`}>{power > 0 ? power.toFixed(0) : '0'}</td>
                        <td className={`py-4 px-5 text-right ${!miner.online ? 'text-slate-500' : 'text-slate-400'}`}>{rpm > 0 ? rpm : '0'}</td>
                        <td className="py-4 px-5 text-right text-slate-500">{diff > 0 ? formatDiff(diff) : '—'}</td>
                        <td className="py-4 px-5">
                          <div className={`flex justify-center ${!miner.online ? 'opacity-50' : ''}`}>
                            <HealthGauge score={health} />
                          </div>
                        </td>
                        <td className="py-4 px-5 text-center">
                          <RebootButton miner={miner} onReboot={handleReboot} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              )}
            </table>
          </div>
        </div>

        {/* Right Column Panels */}
        <aside className="xl:col-span-4 flex flex-col gap-8">

          {/* Advisor Panel */}
          <div className="nova-glass p-6">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-xs uppercase tracking-wider text-slate-400 font-semibold flex items-center gap-2">
                <Bot className="w-4 h-4 text-btc-500" strokeWidth={2.5} /> Auto-Conseiller
              </h3>
              <button
                type="button"
                onClick={() => void refetch()}
                className="focus-ring text-[10px] uppercase font-semibold text-btc-500 hover:text-white transition-colors"
              >
                Diagnostic
              </button>
            </div>
            <div className="space-y-4 font-sans text-sm">
              {recommendations.length === 0 && !loading && (
                <div className="p-4 bg-emerald-500/5 border border-emerald-500/10 rounded-lg">
                  <div className="flex gap-3">
                    <CheckCircle2 className="w-[18px] h-[18px] text-emerald-500 shrink-0 mt-0.5" />
                    <div>
                      <div className="text-slate-200 font-medium">Tous les systèmes sont nominaux</div>
                      <div className="text-xs text-slate-400 mt-1">Aucune recommandation active pour la flotte.</div>
                    </div>
                  </div>
                </div>
              )}
              {recommendations.slice(0, 3).map((rec) => {
                const tone = advisorTone(rec.severity);
                return (
                  <div key={rec.id} className={`p-4 border rounded-lg group ${tone.wrap}`}>
                    <div className="flex gap-3">
                      {tone.icon}
                      <div>
                        <div className="text-slate-200 font-medium">{rec.title}</div>
                        <div className="text-xs text-slate-400 mt-1">{rec.detail}</div>
                        <Link
                          href={rec.href}
                          className={`focus-ring mt-2 text-xs font-semibold flex items-center gap-1 group-hover:translate-x-1 transition-transform ${tone.action}`}
                        >
                          {rec.actionLabel} <ArrowRight className="w-3 h-3" strokeWidth={3} />
                        </Link>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* 24h Fleet Hashrate */}
          <div className="nova-glass p-6 relative overflow-hidden group">
            <div className="flex justify-between items-start mb-6">
              <div>
                <h3 className="text-xs uppercase tracking-wider text-slate-400 font-semibold">Hashrate flotte 24h</h3>
                <div className="text-slate-200 text-2xl font-mono font-bold mt-1">
                  {sparkAvg > 0 ? sparkAvg.toFixed(1) : '—'} <span className="text-sm font-sans text-slate-500 font-normal">TH/s moy.</span>
                </div>
              </div>
              <div className="text-right font-mono text-xs text-slate-500 space-y-1">
                <div>Pic <span className="text-emerald-400">{sparkPeak > 0 ? sparkPeak.toFixed(1) : '—'}</span></div>
                <div>Creux <span className="text-rose-400">{sparkPeak > 0 ? sparkDip.toFixed(1) : '—'}</span></div>
              </div>
            </div>

            {/* Smooth SVG Chart */}
            <div className="h-24 w-full relative">
              {/* Helper grid lines */}
              <div className="absolute inset-0 flex flex-col justify-between pointer-events-none opacity-20">
                <div className="border-t border-white/10 w-full" />
                <div className="border-t border-white/10 w-full" />
                <div className="border-t border-white/10 w-full border-dashed" />
              </div>
              {fleetSpark.length > 1 ? (
                <SmoothSpark data={fleetSpark} width={400} height={100} strokeWidth={2} withDot />
              ) : (
                <div className="absolute inset-0 flex items-center justify-center text-xs text-slate-600 font-sans">
                  Télémétrie en cours de collecte...
                </div>
              )}
            </div>
          </div>

          {/* Probabilité de bloc (loterie solo) */}
          <div className="nova-glass p-6">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-xs uppercase tracking-wider text-slate-400 font-semibold flex items-center gap-2">
                <Dices className="w-4 h-4 text-btc-500" /> Probabilité de bloc
              </h3>
              {blockOdds && (
                <span className="text-[10px] text-slate-500 font-mono">
                  {(totals?.hashrateTHs || 0).toFixed(1)} TH/s vs diff réseau
                </span>
              )}
            </div>
            <p className="text-xs text-slate-500 font-sans mt-0 mb-4">
              Chance de trouver au moins un bloc en minant en continu au hashrate actuel —
              le solo est une loterie, chaque hash est un ticket.
            </p>
            {!blockOdds ? (
              <div className="text-xs text-slate-600 font-sans">
                En attente du hashrate et de la difficulté réseau...
              </div>
            ) : (
              <>
                <div className="space-y-2.5">
                  {blockOdds.horizons.map((h) => (
                    <div key={h.label} className="flex items-center gap-3">
                      <span className="text-[11px] font-sans text-slate-400 w-20 shrink-0">{h.label}</span>
                      <div className="flex-1 h-1 bg-white/10 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-btc-500 rounded-full"
                          style={{ width: `${Math.max(1.5, (h.p / blockOdds.maxP) * 100)}%` }}
                        />
                      </div>
                      <span className="text-[11px] font-mono font-semibold text-slate-200 w-24 text-right shrink-0">
                        {fmtOdds(h.p)}
                      </span>
                    </div>
                  ))}
                </div>
                <div className="mt-4 pt-3 border-t border-white/5 text-[11px] font-mono text-slate-500">
                  Temps moyen statistique :{' '}
                  <span className="text-btc-500 font-semibold">
                    {blockOdds.expectedYears >= 1
                      ? `≈ ${fmtCompact(Math.round(blockOdds.expectedYears))} an${blockOdds.expectedYears >= 2 ? 's' : ''}`
                      : `≈ ${Math.max(1, Math.round(blockOdds.expectedYears * 12))} mois`}
                  </span>
                </div>
              </>
            )}
          </div>

          {/* Recent Alerts Feed */}
          <div className="nova-glass p-6 flex-1 max-h-[360px] flex flex-col">
            <div className="flex items-center justify-between mb-5 border-b border-white/5 pb-3">
              <h3 className="text-xs uppercase tracking-wider text-slate-400 font-semibold">Flux en direct</h3>
              <Link href="/alerts" className="focus-ring text-[10px] uppercase font-semibold text-btc-500 hover:text-white transition-colors">
                Tout voir →
              </Link>
            </div>
            <div className="space-y-5 overflow-y-auto flex-1 pr-2 pb-2">
              {feedLoaded && feed.length === 0 && (
                <div className="text-xs text-slate-500 font-sans">Aucun événement récent.</div>
              )}
              {feed.map((event) => {
                const tone = FEED_TONES[event.type] || FEED_TONES['daily-report'];
                return (
                  <div key={`${event.ts}-${event.minerId}-${event.type}`} className="flex gap-3">
                    <div className="mt-1"><div className={`w-1.5 h-1.5 rounded-full ${tone.dot}`} /></div>
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <span className={`text-[9px] font-mono font-semibold border px-1 py-0.5 rounded ${tone.chip}`}>{tone.label}</span>
                        <span className="text-[10px] text-slate-500 font-mono">{formatTime(event.ts)}</span>
                      </div>
                      <p className="text-xs text-slate-300 whitespace-normal break-words">{event.message}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

        </aside>

      </div>

      </div>
    </>
  );
}
