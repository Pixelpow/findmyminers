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
  Gauge,
  Plus,
  X,
  Trash2,
} from 'lucide-react';
import { buildFleetRecommendations, type AdvisorRecommendation } from '@/lib/advisor';
import { TIER_META, type OcTier } from '@/lib/overclock';
import { formatDiff, formatTime, fmtCompact, fmtHash } from '@/lib/format';
import { useSmartPolling, getPollCache, setPollCache } from '@/lib/use-smart-polling';
import { useToast } from '@/components/ToastProvider';
import { useT, useLang } from '@/lib/i18n';
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
    rejected?: number;
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
  ocActiveTier?: { tier: OcTier; label: string; source: 'window' | 'default' } | null;
};

type ProfitPayload = {
  totals?: { dailyNetEur?: number; monthlyNetEur?: number; dailyElecCostEur?: number; dailyGrossEur?: number };
  crypto?: { btcPriceEur?: number; btcPriceUsd?: number; difficulty?: number };
  config?: { elecCostEurKwh?: number; poolFeePct?: number; showProfitability?: boolean };
};

type AlertEvent = {
  ts: number;
  type: string;
  minerId: string;
  minerName: string;
  message: string;
};

const FEED_TONES: Record<string, { label: string; labelEn: string; chip: string; dot: string }> = {
  'pool-down': { label: 'POOL HS', labelEn: 'POOL DOWN', chip: 'bg-rose-500/10 text-rose-400 border-rose-500/20', dot: 'bg-rose-500 dot-glow-rose' },
  thermal: { label: 'THERMIQUE', labelEn: 'THERMAL', chip: 'bg-amber-500/10 text-amber-500 border-amber-500/20', dot: 'bg-amber-500 dot-glow-amber' },
  'hashrate-drop': { label: 'HASHRATE', labelEn: 'HASHRATE', chip: 'bg-amber-500/10 text-amber-500 border-amber-500/20', dot: 'bg-amber-500 dot-glow-amber' },
  anomaly: { label: 'ANOMALIE', labelEn: 'ANOMALY', chip: 'bg-btc-500/10 text-btc-500 border-btc-500/20', dot: 'bg-btc-500 dot-glow-btc' },
  maintenance: { label: 'MAINTENANCE', labelEn: 'MAINTENANCE', chip: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20', dot: 'bg-emerald-500 dot-glow-emerald' },
  'daily-report': { label: 'SYSTÈME', labelEn: 'SYSTEM', chip: 'bg-slate-500/10 text-slate-400 border-slate-500/20', dot: 'bg-slate-500' },
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
  const t = useT();
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
      title={confirm ? t('Clique pour confirmer le redémarrage', 'Click to confirm reboot') : t('Redémarrer ce mineur', 'Reboot this miner')}
      aria-label={`${t('Redémarrer', 'Reboot')} ${miner.name}`}
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

/** Bouton de suppression à double clic (retire le mineur de la flotte). */
function DeleteButton({ miner, onRemove }: { miner: FleetMiner; onRemove: (m: FleetMiner) => Promise<void> }) {
  const t = useT();
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
    void onRemove(miner).finally(() => setBusy(false));
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={busy}
      title={confirm ? t('Clique pour confirmer la suppression', 'Click to confirm removal') : t('Retirer ce mineur de la flotte', 'Remove this miner from the fleet')}
      aria-label={`${t('Retirer', 'Remove')} ${miner.name}`}
      className={`focus-ring p-1 rounded transition-all ${
        confirm
          ? 'text-rose-400 bg-rose-500/10 border border-rose-500/30 opacity-100'
          : 'text-slate-500 hover:text-rose-400 opacity-0 group-hover:opacity-100'
      }`}
    >
      <Trash2 className="w-3.5 h-3.5" />
    </button>
  );
}

export default function DashboardPage() {
  const router = useRouter();
  const { toast } = useToast();
  const t = useT();
  const { lang } = useLang();
  const [profit, setProfit] = useState<ProfitPayload | null>(() => getPollCache<ProfitPayload>('profitability'));
  const [feed, setFeed] = useState<AlertEvent[]>(() => getPollCache<AlertEvent[]>('alerts-feed') ?? []);
  const [feedLoaded, setFeedLoaded] = useState(() => getPollCache('alerts-feed') !== null);
  const [scanning, setScanning] = useState(false);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  // Ajout manuel d'un mineur par IP (fonctionne même quand le scan échoue).
  const [showAdd, setShowAdd] = useState(false);
  const [addIp, setAddIp] = useState('');
  const [addPort, setAddPort] = useState('');
  const [addBusy, setAddBusy] = useState(false);

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
      if (!data.discovered) {
        toast('warning', t('Aucun mineur trouvé sur le réseau. En Docker/VLAN, utilise « Ajouter » par IP.', 'No miner found on the network. On Docker/VLAN, use “Add” by IP.'));
      } else {
        const added = data.added || 0;
        toast('success', t(`${data.discovered} mineur(s) trouvé(s)${added ? ` · ${added} ajouté(s)` : ''}`, `${data.discovered} miner(s) found${added ? ` · ${added} added` : ''}`));
      }
      await refetch();
    } catch { /* ignore */ }
    finally { setScanning(false); }
  };

  const runAdd = async () => {
    const ip = addIp.trim();
    if (!ip || addBusy) return;
    setAddBusy(true);
    try {
      const res = await fetch('/api/miner/add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ip, port: addPort.trim() ? Number(addPort.trim()) : undefined }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Ajout impossible');
      toast('success', `${data.miner?.name || ip} ${t('ajouté', 'added')}`);
      setShowAdd(false);
      setAddIp('');
      setAddPort('');
      await refetch();
    } catch (e) {
      toast('error', e instanceof Error ? e.message : t('Ajout impossible', 'Could not add miner'));
    } finally {
      setAddBusy(false);
    }
  };

  const fleet = useMemo(() => fleetData?.fleet ?? [], [fleetData]);
  const totals = fleetData?.totals;
  const total = totals?.miners || 0;
  const online = totals?.online || 0;
  const offline = Math.max(0, total - online);
  const avgTemp = totals?.avgTempC || 0;
  const powerW = totals?.powerW || 0;

  const recommendations = useMemo(() => buildFleetRecommendations(fleet, total, t), [fleet, total, t]);
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
      { labelFr: '24 heures', labelEn: '24 hours', seconds: 86_400 },
      { labelFr: '30 jours', labelEn: '30 days', seconds: 30 * 86_400 },
      { labelFr: '1 an', labelEn: '1 year', seconds: 365.25 * 86_400 },
      { labelFr: '5 ans', labelEn: '5 years', seconds: 5 * 365.25 * 86_400 },
      { labelFr: '10 ans', labelEn: '10 years', seconds: 10 * 365.25 * 86_400 },
    ].map((h) => ({ ...h, p: 1 - Math.exp(-lambdaPerSec * h.seconds) }));
    const expectedYears = 1 / (lambdaPerSec * 365.25 * 86_400);
    return { horizons, expectedYears, maxP: horizons[horizons.length - 1].p };
  }, [totals?.hashrateTHs, profit?.crypto?.difficulty]);

  const fmtOdds = (p: number) => {
    if (p >= 0.01) return `${(p * 100).toFixed(1)} %`;
    if (p >= 0.0001) return `${(p * 100).toFixed(3)} %`;
    return `${t('1 sur', '1 in')} ${fmtCompact(Math.round(1 / p))}`;
  };

  const elecCostHour = powerW > 0 && profit?.config?.elecCostEurKwh !== undefined
    ? (powerW / 1000) * profit.config.elecCostEurKwh
    : null;
  const netDaily = profit?.totals?.dailyNetEur;
  const grossDaily = profit?.totals?.dailyGrossEur
    ?? (netDaily !== undefined ? netDaily + (profit?.totals?.dailyElecCostEur || 0) : undefined);
  const showProfit = profit?.config?.showProfitability ?? false;
  // Métrique clé du solo mining : le meilleur partage de la flotte (« ticket de loterie »).
  const fleetBestDiff = fleet.reduce((max, m) => Math.max(max, m.latest?.bestShare || 0), 0);

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
      if (!res.ok) throw new Error(payload.error || t('Redémarrage refusé', 'Reboot rejected'));
      toast('success', `${t('Redémarrage demandé', 'Reboot requested')} · ${miner.name}`);
    } catch (e) {
      toast('error', e instanceof Error ? e.message : t('Redémarrage échoué', 'Reboot failed'));
    }
  }, [toast, t]);

  const handleRemove = useCallback(async (miner: FleetMiner) => {
    try {
      const res = await fetch('/api/miner/remove', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: miner.id }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.error || t('Suppression refusée', 'Removal rejected'));
      toast('success', `${miner.name} ${t('retiré de la flotte', 'removed from the fleet')}`);
      await refetch();
    } catch (e) {
      toast('error', e instanceof Error ? e.message : t('Suppression échouée', 'Removal failed'));
    }
  }, [toast, t, refetch]);

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
        <title>{t('Tableau de bord', 'Dashboard')} · FindMyMiners</title>
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
          <div className="text-[10px] uppercase tracking-widest text-slate-400 font-semibold mb-4">{t('Flotte active', 'Active fleet')}</div>
          <div className="font-mono text-3xl text-slate-100 font-bold tracking-tight">{loading ? '—' : total.toLocaleString()}</div>
          <div className={`text-[11px] font-mono mt-2 flex items-center gap-1 ${offline > 0 ? 'text-amber-400' : 'text-emerald-400'}`}>
            <TrendingUp className="w-3 h-3" strokeWidth={3} />
            <span>{loading ? '· · ·' : `${online} ${t('en ligne', 'online')}`}</span>
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
                  <span className="text-[10px] font-mono text-btc-500 bg-obsidian-950/80 px-1 rounded backdrop-blur">{sparkAvg.toFixed(1)} {t('moy.', 'avg')}</span>
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
          <div className="text-[10px] uppercase tracking-widest text-slate-400 font-semibold mb-4">{t('Conso totale', 'Total power')}</div>
          <div className="font-mono text-3xl text-slate-100 font-bold tracking-tight flex items-baseline gap-1">
            {loading ? '—' : powerW >= 10_000 ? (powerW / 1000).toFixed(2) : powerW.toFixed(0)}
            <span className="text-xs text-slate-500 font-sans tracking-normal">{powerW >= 10_000 ? 'kW' : 'W'}</span>
          </div>
          <div className="text-[11px] font-mono text-slate-400 mt-3">
            {elecCostHour !== null ? `${t('Coût', 'Cost')} : €${elecCostHour.toFixed(2)} / h` : `${t('Coût', 'Cost')} : —`}
          </div>
        </div>

        {/* Avg Temp */}
        <div className="nova-glass p-5 flex flex-col justify-between group transition-transform hover:-translate-y-[1px]">
          <div className="text-[10px] uppercase tracking-widest text-slate-400 font-semibold mb-4">{t('Temp moyenne', 'Avg temp')}</div>
          <div className={`font-mono text-3xl font-bold tracking-tight flex items-baseline gap-1 ${
            avgTemp >= 85 ? 'text-rose-500 glow-rose' : avgTemp >= 70 ? 'text-amber-400 glow-amber' : 'text-slate-100'
          }`}>
            {loading || avgTemp <= 0 ? '—' : avgTemp.toFixed(1)} <span className="text-xs font-sans tracking-normal">°C</span>
          </div>
          <div className="text-[11px] font-mono text-slate-500 mt-3">
            {t('Cible', 'Target')} &lt; 70°C
          </div>
        </div>

        {/* Brut / jour (rentabilité) ou Meilleur diff (solo) */}
        <div className="nova-glass p-5 flex flex-col justify-between group transition-transform hover:-translate-y-[1px]">
          {showProfit ? (
            <>
              <div className="text-[10px] uppercase tracking-widest text-btc-500 font-semibold mb-4">{t('Brut / jour', 'Gross / day')}</div>
              <div className="font-mono text-3xl text-slate-100 font-bold tracking-tight">{fmtEur0(grossDaily)}</div>
              <div className="text-[11px] font-mono text-slate-400 mt-3 pt-1 border-t border-white/5">
                {t('Net proj.', 'Net est.')} : {netDaily !== undefined ? `${fmtEur0(netDaily)} / ${t('jour', 'day')}` : '—'}
              </div>
            </>
          ) : (
            <>
              <div className="text-[10px] uppercase tracking-widest text-amber-300/80 font-semibold mb-4">{t('Meilleur diff', 'Best diff')}</div>
              <div className="font-mono text-3xl text-amber-300 glow-amber font-bold tracking-tight">{fleetBestDiff > 0 ? formatDiff(fleetBestDiff) : '—'}</div>
              <div className="text-[11px] font-mono text-slate-400 mt-3 pt-1 border-t border-white/5">
                {t('Réseau', 'Network')} : {profit?.crypto?.difficulty ? formatDiff(profit.crypto.difficulty) : '—'}
              </div>
            </>
          )}
        </div>

        {/* Active Alerts */}
        <div className="nova-glass p-5 flex flex-col justify-between group transition-transform hover:-translate-y-[1px]">
          <div className="text-[10px] uppercase tracking-widest text-slate-400 font-semibold mb-4">{t('Alertes actives', 'Active alerts')}</div>
          <div className="font-mono text-3xl text-slate-100 font-bold tracking-tight">{loading ? '—' : alertsCount}</div>
          <div className="flex items-center gap-2 mt-2">
            <span className="text-[10px] font-mono bg-rose-500/10 text-rose-500 px-1.5 py-0.5 rounded border border-rose-500/20">{criticalCount} {t('Crit.', 'Crit.')}</span>
            <span className="text-[10px] font-mono bg-amber-500/10 text-amber-500 px-1.5 py-0.5 rounded border border-amber-500/20">{warningCount} {t('Avert.', 'Warn.')}</span>
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
              <h2 className="text-sm font-semibold text-slate-200 shrink-0">{t('Mineurs actifs', 'Active miners')}</h2>
              {fleetData?.ocActiveTier ? (
                <Link
                  href="/overclock"
                  className={`text-[9px] font-mono font-semibold border px-1.5 py-0.5 rounded ${TIER_META[fleetData.ocActiveTier.tier].chip} ${TIER_META[fleetData.ocActiveTier.tier].text}`}
                  title={`${t('Planification overclock active — palier', 'Overclock schedule active — tier')} ${TIER_META[fleetData.ocActiveTier.tier].label} (${fleetData.ocActiveTier.source === 'window' ? fleetData.ocActiveTier.label : t('hors créneau', 'default')})`}
                >
                  {TIER_META[fleetData.ocActiveTier.tier].emoji} {TIER_META[fleetData.ocActiveTier.tier].label.toUpperCase()}
                </Link>
              ) : fleetData?.nightModeActive && (
                <span className="text-[9px] font-mono font-semibold border px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400 border-blue-500/20" title={t('Le planning nuit (ventilation / mode réduit) est actuellement appliqué', 'Night schedule (reduced fan/mode) is currently applied')}>
                  🌙 {t('MODE NUIT', 'NIGHT MODE')}
                </span>
              )}
              {fleetData?.vacationMode && (
                <span className="text-[9px] font-mono font-semibold border px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-500 border-amber-500/20" title={t("Mode vacances : l'auto-reboot et les automatismes sont suspendus", 'Vacation mode: auto-reboot and automations are paused')}>
                  ✈ {t('VACANCES', 'VACATION')}
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
                  placeholder={t('Rechercher un mineur...', 'Search a miner...')}
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
                aria-label={t('Changer de filtre', 'Change filter')}
                title={`${t('Filtre', 'Filter')} : ${filter === 'all' ? t('tous', 'all') : filter === 'online' ? t('en ligne', 'online') : t('problèmes', 'issues')}`}
              >
                <SlidersHorizontal className="w-4 h-4" />
              </button>
              <div className="w-px h-5 bg-white/10 mx-0.5" />
              <button
                type="button"
                onClick={() => setShowAdd(true)}
                className="focus-ring inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded border bg-btc-500/10 border-btc-500/30 text-btc-400 hover:bg-btc-500/20 transition-colors text-xs font-semibold"
                title={t('Ajouter un mineur par son IP', 'Add a miner by IP')}
              >
                <Plus className="w-3.5 h-3.5" /> {t('Ajouter', 'Add')}
              </button>
              <button
                type="button"
                onClick={() => void runScan()}
                disabled={scanning}
                className="focus-ring p-1.5 rounded border bg-white/5 border-white/10 text-slate-400 hover:text-white hover:bg-white/10 transition-colors disabled:opacity-50"
                aria-label={t('Scanner le réseau', 'Scan the network')}
                title={t('Scanner le réseau (ajout automatique)', 'Scan the network (auto-add)')}
              >
                <Radar className={`w-4 h-4 ${scanning ? 'animate-spin' : ''}`} />
              </button>
              <button
                type="button"
                onClick={() => void refetch()}
                className="focus-ring p-1.5 rounded border bg-white/5 border-white/10 text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
                aria-label={t('Rafraîchir', 'Refresh')}
                title={t('Rafraîchir les données', 'Refresh data')}
              >
                <RefreshCw className="w-4 h-4" />
              </button>
              <Link
                href="/overclock"
                className="focus-ring p-1.5 rounded border bg-white/5 border-white/10 text-slate-400 hover:text-btc-500 hover:bg-white/10 transition-colors"
                aria-label="Overclock"
                title={t("Régler l'overclock de la flotte", 'Tune fleet overclock')}
              >
                <Gauge className="w-4 h-4" />
              </Link>
            </div>
          </div>

          {/* Table Container (Scrollable) */}
          <div className="flex-1 overflow-auto relative max-h-[640px]">
            <table className="nova-table w-full text-left font-mono text-xs whitespace-nowrap">
              <thead className="text-[10px] uppercase tracking-wider text-slate-500 sticky top-0 z-10">
                <tr>
                  <th className="py-4 px-5 w-10 font-semibold">{t('Ét', 'St')}</th>
                  {([
                    ['name', 'Mineur / Modèle', 'Miner / Model', ''],
                    [null, 'Pool', 'Pool', ''],
                    ['hashrate', 'Hashrate', 'Hashrate', 'text-right'],
                    ['temp', 'Temp', 'Temp', 'text-right'],
                    ['power', 'Conso', 'Power', 'text-right'],
                    [null, 'RPM', 'RPM', 'text-right'],
                    [null, 'Diff', 'Diff', 'text-right'],
                    [null, 'Shares', 'Shares', 'text-right'],
                    ['health', 'Santé', 'Health', 'text-center'],
                  ] as [SortKey | null, string, string, string][]).map(([key, fr, en, align]) => (
                    <th key={fr} className={`py-4 px-5 font-semibold ${align}`}>
                      {key ? (
                        <button
                          type="button"
                          onClick={() => toggleSort(key)}
                          className={`focus-ring inline-flex items-center gap-1 uppercase tracking-wider transition-colors ${sortKey === key ? 'text-slate-200' : 'hover:text-slate-300'}`}
                        >
                          {t(fr, en)}
                          {sortKey === key
                            ? (sortDir === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />)
                            : <ChevronUp className="w-3 h-3 opacity-25" />}
                        </button>
                      ) : t(fr, en)}
                    </th>
                  ))}
                  <th className="py-4 px-5 font-semibold text-center w-10">{t('Act', 'Act')}</th>
                </tr>
              </thead>

              {loading ? (
                <tbody className="divide-y divide-white/[0.03]">
                  {[0, 1, 2, 3].map((i) => (
                    <tr key={i} className="nova-shimmer">
                      <td className="py-4 px-4" colSpan={11}>
                        <div className={`h-4 bg-white/5 rounded ${i === 1 ? 'w-11/12' : i === 3 ? 'w-10/12' : 'w-full'}`} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              ) : total === 0 ? (
                <tbody>
                  <tr>
                    <td colSpan={11} className="py-24 text-center">
                      <div className="inline-flex items-center justify-center w-12 h-12 rounded-full border border-dashed border-slate-600 mb-4 bg-obsidian-950">
                        <Radar className="w-5 h-5 text-slate-500" />
                      </div>
                      <h3 className="text-slate-300 font-sans font-semibold mb-1 text-sm">{t('Aucun mineur détecté', 'No miner detected')}</h3>
                      <p className="text-slate-500 font-sans text-xs mb-4">{t('Scanne le réseau, ou ajoute un mineur par son IP.', 'Scan the network, or add a miner by its IP.')}</p>
                      <div className="flex items-center justify-center gap-2">
                        <button
                          type="button"
                          onClick={runScan}
                          disabled={scanning}
                          className="focus-ring bg-white text-obsidian-950 font-sans font-semibold text-xs px-4 py-2 rounded shadow hover:bg-slate-200 transition-colors active:scale-95 disabled:opacity-60"
                        >
                          {scanning ? t('Scan du réseau...', 'Scanning...') : t('Lancer un scan réseau', 'Scan the network')}
                        </button>
                        <button
                          type="button"
                          onClick={() => setShowAdd(true)}
                          className="focus-ring font-sans font-semibold text-xs px-4 py-2 rounded border border-btc-500/30 bg-btc-500/10 text-btc-400 hover:bg-btc-500/20 transition-colors active:scale-95"
                        >
                          {t('Ajouter manuellement', 'Add manually')}
                        </button>
                      </div>
                    </td>
                  </tr>
                </tbody>
              ) : (
                <tbody className="divide-y divide-white/[0.03]">
                  {visibleFleet.length === 0 && (
                    <tr>
                      <td colSpan={11} className="py-12 text-center text-slate-500 font-sans text-xs">
                        {t('Aucun mineur ne correspond à ce filtre.', 'No miner matches this filter.')}
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
                    const acc = miner.latest?.accepted || 0;
                    const rej = miner.latest?.rejected || 0;
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
                              <span className="bg-rose-500/10 text-rose-500 text-[9px] px-1 rounded border border-rose-500/20">{t('PANNE', 'DOWN')}</span>
                            )}
                          </div>
                          <div className="text-[10px] text-slate-500">{miner.model || t('Modèle inconnu', 'Unknown model')}</div>
                        </td>
                        <td className="py-4 px-5">
                          <div className="flex items-center gap-1.5">
                            <div className={`w-1 h-1 rounded-full ${poolAlive ? 'bg-emerald-500' : 'bg-rose-500'}`} />
                            {poolAlive ? (
                              <span className="text-slate-400">{miner.poolUrl ? poolHost(miner.poolUrl) : '—'}</span>
                            ) : (
                              <span className="text-rose-400">{t('pool injoignable', 'pool unreachable')}</span>
                            )}
                          </div>
                        </td>
                        <td className="py-4 px-5 text-right">
                          <div className={`flex items-center justify-end gap-2 ${hrTone}`}>
                            <span>{miner.online ? fmtHash(hr) : '—'}</span>
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
                        <td className={`py-4 px-5 text-right ${!miner.online ? 'text-slate-500' : 'text-slate-400'}`}>{power > 0 ? <>{power.toFixed(0)}<span className="text-slate-600"> W</span></> : '—'}</td>
                        <td className={`py-4 px-5 text-right ${!miner.online ? 'text-slate-500' : 'text-slate-400'}`}>{rpm > 0 ? rpm.toLocaleString() : '—'}</td>
                        <td className={`py-4 px-5 text-right font-semibold ${diff > 0 ? 'text-amber-300' : 'text-slate-500'}`}>{diff > 0 ? formatDiff(diff) : '—'}</td>
                        <td className="py-4 px-5 text-right">
                          {acc > 0 ? (
                            <span className="inline-flex items-baseline justify-end gap-1">
                              <span className={!miner.online ? 'text-slate-500' : 'text-emerald-400 glow-emerald'}>{fmtCompact(acc)}</span>
                              {rej > 0 && <span className="text-rose-500/70 text-[11px]">/{fmtCompact(rej)}</span>}
                            </span>
                          ) : <span className="text-slate-500">—</span>}
                        </td>
                        <td className="py-4 px-5">
                          <div className={`flex justify-center ${!miner.online ? 'opacity-50' : ''}`}>
                            <HealthGauge score={health} />
                          </div>
                        </td>
                        <td className="py-4 px-5 text-center">
                          <div className="flex items-center justify-center gap-1">
                            <RebootButton miner={miner} onReboot={handleReboot} />
                            <DeleteButton miner={miner} onRemove={handleRemove} />
                          </div>
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
                      <div className="text-slate-200 font-medium">{t('Tous les systèmes sont nominaux', 'All systems nominal')}</div>
                      <div className="text-xs text-slate-400 mt-1">{t('Aucune recommandation active pour la flotte.', 'No active recommendations for the fleet.')}</div>
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
                <h3 className="text-xs uppercase tracking-wider text-slate-400 font-semibold">{t('Hashrate flotte 24h', 'Fleet hashrate 24h')}</h3>
                <div className="text-slate-200 text-2xl font-mono font-bold mt-1">
                  {sparkAvg > 0 ? sparkAvg.toFixed(1) : '—'} <span className="text-sm font-sans text-slate-500 font-normal">TH/s {t('moy.', 'avg')}</span>
                </div>
              </div>
              <div className="text-right font-mono text-xs text-slate-500 space-y-1">
                <div>{t('Pic', 'Peak')} <span className="text-emerald-400">{sparkPeak > 0 ? sparkPeak.toFixed(1) : '—'}</span></div>
                <div>{t('Creux', 'Low')} <span className="text-rose-400">{sparkPeak > 0 ? sparkDip.toFixed(1) : '—'}</span></div>
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
                <Dices className="w-4 h-4 text-btc-500" /> {t('Probabilité de bloc', 'Block odds')}
              </h3>
              {blockOdds && (
                <span className="text-[10px] text-slate-500 font-mono">
                  {(totals?.hashrateTHs || 0).toFixed(1)} TH/s {t('vs diff réseau', 'vs network diff')}
                </span>
              )}
            </div>
            <p className="text-xs text-slate-500 font-sans mt-0 mb-4">
              {t('Chance de trouver au moins un bloc en minant en continu au hashrate actuel — le solo est une loterie, chaque hash est un ticket.', 'Odds of finding at least one block mining continuously at the current hashrate — solo is a lottery, every hash is a ticket.')}
            </p>
            {!blockOdds ? (
              <div className="text-xs text-slate-600 font-sans">
                {t('En attente du hashrate et de la difficulté réseau...', 'Waiting for hashrate and network difficulty...')}
              </div>
            ) : (
              <>
                <div className="space-y-2.5">
                  {blockOdds.horizons.map((h) => (
                    <div key={h.labelEn} className="flex items-center gap-3">
                      <span className="text-[11px] font-sans text-slate-400 w-20 shrink-0">{t(h.labelFr, h.labelEn)}</span>
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
                  {t('Temps moyen statistique', 'Statistical mean time')} :{' '}
                  <span className="text-btc-500 font-semibold">
                    {blockOdds.expectedYears >= 1
                      ? `≈ ${fmtCompact(Math.round(blockOdds.expectedYears))} ${t('an', 'yr')}${blockOdds.expectedYears >= 2 ? 's' : ''}`
                      : `≈ ${Math.max(1, Math.round(blockOdds.expectedYears * 12))} ${t('mois', 'months')}`}
                  </span>
                </div>
              </>
            )}
          </div>

          {/* Recent Alerts Feed */}
          <div className="nova-glass p-6 flex-1 max-h-[360px] flex flex-col">
            <div className="flex items-center justify-between mb-5 border-b border-white/5 pb-3">
              <h3 className="text-xs uppercase tracking-wider text-slate-400 font-semibold">{t('Flux en direct', 'Live feed')}</h3>
              <Link href="/alerts" className="focus-ring text-[10px] uppercase font-semibold text-btc-500 hover:text-white transition-colors">
                {t('Tout voir', 'View all')} →
              </Link>
            </div>
            <div className="space-y-5 overflow-y-auto flex-1 pr-2 pb-2">
              {feedLoaded && feed.length === 0 && (
                <div className="text-xs text-slate-500 font-sans">{t('Aucun événement récent.', 'No recent events.')}</div>
              )}
              {feed.map((event) => {
                const tone = FEED_TONES[event.type] || FEED_TONES['daily-report'];
                return (
                  <div key={`${event.ts}-${event.minerId}-${event.type}`} className="flex gap-3">
                    <div className="mt-1"><div className={`w-1.5 h-1.5 rounded-full ${tone.dot}`} /></div>
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <span className={`text-[9px] font-mono font-semibold border px-1 py-0.5 rounded ${tone.chip}`}>{t(tone.label, tone.labelEn)}</span>
                        <span className="text-[10px] text-slate-500 font-mono">{formatTime(event.ts, lang)}</span>
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

      {/* Modal d'ajout manuel d'un mineur par IP */}
      {showAdd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" data-modal-overlay onClick={() => { if (!addBusy) setShowAdd(false); }}>
          <div className="absolute inset-0 bg-obsidian-950/70 backdrop-blur-sm" />
          <div className="relative w-full max-w-md nova-glass rounded-2xl p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2 mb-1">
              <Plus className="w-5 h-5 text-btc-500" />
              <h3 className="text-base font-semibold text-slate-100">{t('Ajouter un mineur', 'Add a miner')}</h3>
              <button onClick={() => setShowAdd(false)} className="ml-auto p-1 text-slate-500 hover:text-slate-200"><X className="w-4 h-4" /></button>
            </div>
            <p className="text-[13px] text-slate-400 mb-4">{t('Entre l’adresse IP du mineur. Pratique quand le scan réseau ne le trouve pas (Docker, VLAN, sous-réseau différent…).', 'Enter the miner’s IP address. Handy when the network scan can’t find it (Docker, VLAN, different subnet…).')}</p>
            <div className="space-y-3">
              <div>
                <label className="block text-[12px] text-slate-400 mb-1.5">{t('Adresse IP', 'IP address')}</label>
                <input
                  value={addIp}
                  onChange={(e) => setAddIp(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') void runAdd(); }}
                  placeholder="192.168.1.50"
                  autoFocus
                  className="focus-ring w-full bg-obsidian-950 border border-white/10 rounded-lg py-2 px-3 text-sm text-slate-200 font-mono"
                />
              </div>
              <div>
                <label className="block text-[12px] text-slate-400 mb-1.5">{t('Port', 'Port')} <span className="text-slate-600">({t('optionnel', 'optional')})</span></label>
                <input
                  value={addPort}
                  onChange={(e) => setAddPort(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') void runAdd(); }}
                  placeholder="auto · 80 (AxeOS) · 4028 (Avalon/CGMiner)"
                  className="focus-ring w-full bg-obsidian-950 border border-white/10 rounded-lg py-2 px-3 text-sm text-slate-200 font-mono"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <button onClick={() => setShowAdd(false)} className="focus-ring px-4 py-2 rounded-lg text-sm text-slate-300 border border-white/10 hover:bg-white/[0.04]">{t('Annuler', 'Cancel')}</button>
              <button
                onClick={() => void runAdd()}
                disabled={addBusy || !addIp.trim()}
                className="focus-ring px-4 py-2 rounded-lg text-sm font-semibold bg-btc-500/20 text-btc-300 border border-btc-500/40 hover:bg-btc-500/30 transition-colors disabled:opacity-50"
              >
                {addBusy ? t('Détection…', 'Detecting…') : t('Ajouter', 'Add')}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
