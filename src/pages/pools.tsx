import { useEffect, useMemo, useRef, useState } from 'react';
import Head from 'next/head';
import {
  Search,
  Plus,
  ChevronUp,
  ChevronDown,
  ChevronsLeft,
  ChevronLeft,
  ChevronRight,
  ChevronsRight,
  ShieldCheck,
  TimerReset,
  Activity,
  Orbit,
  Droplet,
  X,
  Send,
  CheckCircle2,
  AlertCircle,
  Loader2,
} from 'lucide-react';
import { useToast } from '@/components/ToastProvider';
import { getPollCache } from '@/lib/use-smart-polling';

type Pool = {
  id: string;
  name: string;
  algorithm: string;
  url: string;
  username: string;
  password: string;
  /** ms mesurées · null = mesuré mais injoignable · undefined = jamais mesuré */
  ping?: number | null;
};

const COLS = [
  { key: 'name', label: 'Nom', sortable: true },
  { key: 'algorithm', label: 'Algo', sortable: true },
  { key: 'url', label: 'Endpoint', sortable: false },
  { key: 'username', label: 'Worker', sortable: false },
  { key: 'password', label: 'Auth', sortable: false },
  { key: 'ping', label: 'Latence', sortable: true },
  { key: 'apply', label: '', sortable: false },
];

const ROW_OPTIONS = [10, 25, 50, 100];
const STORAGE_KEY = 'findmyminers.pools-catalog';

/**
 * Pools solo connus — vérifiés en ligne (juin 2026).
 * Ton pool actuel en tête, puis Les Chauffagistes (recommandé FR, 0 %),
 * puis tri par frais croissants. Format identifiant : adresseBTC.worker / x.
 */
const KNOWN_SOLO_POOLS: Array<{
  name: string;
  url: string;
  coin: 'BTC' | 'BCH';
  region: 'FR' | 'EU' | 'Monde';
  fees: string;
  note: string;
  featured?: boolean;
  badge?: { label: string; tone: 'emerald' | 'btc' };
}> = [
  { name: 'FindMyBlock · BTC', url: 'stratum+tcp://eu.findmyblock.xyz:3335', coin: 'BTC', region: 'FR', fees: '0 %', note: 'Solo Bitcoin — serveur hébergé en France, mineurs domestiques bienvenus', featured: true, badge: { label: 'RECOMMANDÉ FR', tone: 'btc' } },
  { name: 'FindMyBlock · BCH', url: 'stratum+tcp://eu.bch.findmyblock.xyz:4335', coin: 'BCH', region: 'FR', fees: '0 %', note: 'Solo Bitcoin Cash — même infra française (secours : eu.molepool.com:5566)', featured: true, badge: { label: 'RECOMMANDÉ FR', tone: 'btc' } },
  { name: 'Les Chauffagistes 🇫🇷', url: 'stratum+tcp://chauffagistes-pool.fr:3333', coin: 'BTC', region: 'FR', fees: '0 %', note: 'Pool communautaire français des mineurs-chauffagistes — financé par dons', featured: true, badge: { label: 'RECOMMANDÉ FR', tone: 'btc' } },
  { name: 'Public Pool', url: 'stratum+tcp://public-pool.io:21496', coin: 'BTC', region: 'Monde', fees: '0 %', note: 'Open source, le plus populaire chez les Bitaxe / NerdMiner (serveur US)' },
  { name: 'Braiins Solo', url: 'stratum+tcp://solo.stratum.braiins.com:3333', coin: 'BTC', region: 'EU', fees: '0,5 %', note: 'Infra pro Braiins (Tchéquie) — ports 3333, 443 ou 25' },
  { name: 'ZSolo', url: 'stratum+tcp://btc.zsolo.bid:6057', coin: 'BTC', region: 'EU', fees: '0,5 %', note: 'Pool solo européen — port 6060 pour haute difficulté (NiceHash)' },
  { name: 'AtlasPool', url: 'stratum+tcp://solo.atlaspool.io:3333', coin: 'BTC', region: 'Monde', fees: '1,5 %', note: 'Anycast mondial (dont Francfort & Londres) — minimum 400 GH/s' },
  { name: 'CKPool Solo (Europe)', url: 'stratum+tcp://eusolo.ckpool.org:3333', coin: 'BTC', region: 'EU', fees: '2 %', note: 'Le standard historique du solo (299 blocs depuis 2014) — instance EU' },
  { name: 'CKPool Solo (US)', url: 'stratum+tcp://solo.ckpool.org:3333', coin: 'BTC', region: 'Monde', fees: '2 %', note: 'Instance principale de CKPool aux États-Unis' },
  { name: 'CKPool Solo (Australie)', url: 'stratum+tcp://ausolo.ckpool.org:3333', coin: 'BTC', region: 'Monde', fees: '2 %', note: 'Instance CKPool Australie' },
  { name: 'Solopool.org', url: 'stratum+tcp://btc.solopool.org:8005', coin: 'BTC', region: 'Monde', fees: '1–2 %', note: 'Pool solo multi-coins — vérifie le port exact sur leur page d’aide' },
];

/** Devine la monnaie d'un pool enregistré à partir de son URL ou de son nom. */
function guessCoin(pool: Pool): 'BTC' | 'BCH' {
  const haystack = `${pool.url} ${pool.name}`.toLowerCase();
  return haystack.includes('bch') || haystack.includes('bitcoin cash') || haystack.includes('molepool') ? 'BCH' : 'BTC';
}

type ApplyTarget = { id: string; name: string; model?: string; online?: boolean };
type ApplyResult = { minerId: string; name: string; ok: boolean; queued?: boolean; error?: string };

/**
 * Logos officiels — Bitcoin : ₿ blanc penché à droite sur disque orange ;
 * Bitcoin Cash : même ₿ penché à gauche sur disque vert (#0AC18E).
 * Tracé du ₿ issu du logo Bitcoin standard (cryptocurrency-icons).
 */
const BTC_B_PATH = 'M23.189 14.02c.314-2.096-1.283-3.223-3.465-3.975l.708-2.84-1.728-.43-.69 2.765c-.454-.114-.92-.22-1.385-.326l.695-2.783L15.596 6l-.708 2.839c-.376-.086-.746-.17-1.104-.26l.002-.009-2.384-.595-.46 1.846s1.283.294 1.256.312c.7.175.826.638.805 1.006l-.806 3.235c.048.012.11.03.18.057l-.183-.045-1.13 4.532c-.086.212-.303.531-.793.41.018.025-1.256-.313-1.256-.313l-.858 1.978 2.25.561c.418.105.828.215 1.231.318l-.715 2.872 1.727.43.708-2.84c.472.127.93.245 1.378.357l-.706 2.828 1.728.43.715-2.866c2.948.558 5.164.333 6.097-2.333.752-2.146-.037-3.385-1.588-4.192 1.13-.26 1.98-1.003 2.207-2.538zm-3.95 5.538c-.533 2.147-4.148.986-5.32.695l.95-3.805c1.172.293 4.929.872 4.37 3.11zm.535-5.569c-.487 1.953-3.495.96-4.47.717l.86-3.45c.975.243 4.118.696 3.61 2.733z';

function CoinIcon({ coin, size = 18 }: { coin: 'BTC' | 'BCH'; size?: number }) {
  const isBtc = coin === 'BTC';
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" className="shrink-0" role="img" aria-label={coin}>
      <title>{isBtc ? 'Bitcoin' : 'Bitcoin Cash'}</title>
      <circle cx="16" cy="16" r="16" fill={isBtc ? '#F7931A' : '#0AC18E'} />
      {/* Le ₿ du logo BTC est penché à droite ; celui de BCH penche à gauche. */}
      <path fill="#FFF" d={BTC_B_PATH} transform={isBtc ? undefined : 'rotate(-28 16 16)'} />
    </svg>
  );
}

/** Vert < 50 ms · orange 50–100 ms · rouge > 100 ms ou injoignable · gris jamais mesuré. */
function latencyMeta(value: number | null | undefined) {
  if (value === undefined) return { dot: 'bg-slate-600', text: 'text-slate-500', label: 'non mesuré' };
  if (value === null) return { dot: 'bg-rose-500 dot-glow-rose', text: 'text-rose-400', label: 'INJOIGNABLE' };
  if (value < 50) return { dot: 'bg-emerald-500 dot-glow-emerald', text: 'text-emerald-400', label: `${value} ms` };
  if (value < 100) return { dot: 'bg-amber-500 dot-glow-amber', text: 'text-amber-400', label: `${value} ms` };
  return { dot: 'bg-rose-500 dot-glow-rose', text: 'text-rose-400', label: `${value} ms` };
}

export default function PoolsPage() {
  const { toast } = useToast();
  const [pools, setPools] = useState<Pool[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState('name');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(25);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ name: '', algorithm: 'SHA256', url: '', username: '', password: '' });
  const [pinging, setPinging] = useState(false);
  const [presetPings, setPresetPings] = useState<Record<string, number | null>>({});
  const presetPingInFlight = useRef(false);

  // Modal « Appliquer aux mineurs »
  const [applyPool, setApplyPool] = useState<Pool | null>(null);
  const [applyTargets, setApplyTargets] = useState<ApplyTarget[]>([]);
  const [applySelected, setApplySelected] = useState<Set<string>>(new Set());
  const [applyWorker, setApplyWorker] = useState('');
  const [applyBusy, setApplyBusy] = useState(false);
  const [applyResults, setApplyResults] = useState<ApplyResult[] | null>(null);

  const openApplyModal = async (pool: Pool) => {
    setApplyPool(pool);
    setApplyWorker(pool.username || '');
    setApplyResults(null);
    setApplyBusy(false);
    // Le cache fleet donne noms + statut en ligne instantanément.
    const cachedFleet = getPollCache<{ fleet?: Array<{ id: string; name: string; model?: string; online?: boolean }> }>('fleet');
    const fromCache = (cachedFleet?.fleet || []).map((m) => ({ id: m.id, name: m.name, model: m.model, online: m.online }));
    if (fromCache.length) {
      setApplyTargets(fromCache);
      setApplySelected(new Set(fromCache.map((m) => m.id)));
      return;
    }
    try {
      const res = await fetch('/api/miner/config');
      if (!res.ok) return;
      const json = await res.json();
      const list: ApplyTarget[] = (json.miners || []).map((m: { id: string; name: string; model?: string }) => ({ id: m.id, name: m.name, model: m.model }));
      setApplyTargets(list);
      setApplySelected(new Set(list.map((m) => m.id)));
    } catch { /* ignore */ }
  };

  const runApply = async () => {
    if (!applyPool || !applySelected.size || applyBusy) return;
    if (!applyWorker.trim()) {
      toast('warning', 'Renseigne le wallet.worker avant d’appliquer');
      return;
    }
    setApplyBusy(true);
    setApplyResults(null);
    try {
      const res = await fetch('/api/pools/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          minerIds: [...applySelected],
          pool: { url: applyPool.url, user: applyWorker.trim(), pass: applyPool.password || 'x' },
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'Application échouée');
      const results = (json.results || []) as ApplyResult[];
      setApplyResults(results);
      const okCount = results.filter((r) => r.ok).length;
      toast(okCount === results.length ? 'success' : okCount > 0 ? 'warning' : 'error',
        `Pool appliqué sur ${okCount}/${results.length} mineur${results.length > 1 ? 's' : ''}`);
    } catch (error) {
      toast('error', error instanceof Error ? error.message : 'Application échouée');
    } finally {
      setApplyBusy(false);
    }
  };

  // Ping les pools du catalogue à chaque ouverture de la modal,
  // pour afficher la latence réelle à côté de chaque choix rapide.
  useEffect(() => {
    if (!showAdd || presetPingInFlight.current) return;
    presetPingInFlight.current = true;
    (async () => {
      try {
        const res = await fetch('/api/pools/ping', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ urls: KNOWN_SOLO_POOLS.map((pool) => pool.url) }),
        });
        if (!res.ok) return;
        const { results } = await res.json() as { results: Record<string, number | null> };
        setPresetPings(results);
      } catch { /* ignore */ }
      finally { presetPingInFlight.current = false; }
    })();
  }, [showAdd]);

  // Catalog persists per browser so it survives tab switches and reloads.
  // Loading must happen post-hydration (not in a lazy initializer): the SSR
  // markup is rendered without localStorage, so reading it during the first
  // client render would cause a hydration mismatch.
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) setPools(JSON.parse(raw) as Pool[]);
    } catch { /* ignore */ }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(pools)); } catch { /* ignore */ }
  }, [pools, hydrated]);

  const filtered = useMemo(() => {
    const query = search.toLowerCase();
    return pools.filter((pool) =>
      pool.name.toLowerCase().includes(query) ||
      pool.url.toLowerCase().includes(query) ||
      pool.username.toLowerCase().includes(query)
    );
  }, [pools, search]);

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      const av = (a as Record<string, string | number | undefined>)[sortKey] ?? '';
      const bv = (b as Record<string, string | number | undefined>)[sortKey] ?? '';
      if (av < bv) return sortDir === 'asc' ? -1 : 1;
      if (av > bv) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
  }, [filtered, sortDir, sortKey]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / rowsPerPage));
  const currentPage = Math.min(page, totalPages);
  const paginated = sorted.slice((currentPage - 1) * rowsPerPage, currentPage * rowsPerPage);
  const measuredPools = pools.filter((pool) => pool.ping != null).length;
  const avgLatency = measuredPools
    ? Math.round(pools.filter((pool) => pool.ping != null).reduce((total, pool) => total + (pool.ping || 0), 0) / measuredPools)
    : null;
  const fastPools = pools.filter((pool) => (pool.ping ?? Number.POSITIVE_INFINITY) < 50).length;

  const toggleSort = (key: string) => {
    if (sortKey === key) {
      setSortDir((current) => current === 'asc' ? 'desc' : 'asc');
      return;
    }
    setSortKey(key);
    setSortDir('asc');
  };

  const addPool = () => {
    if (!form.url.trim()) return;

    const id = `pool-${Date.now()}`;
    const name = form.name.trim() || `Pool ${pools.length + 1}`;

    setPools((previous) => [...previous, {
      id,
      name,
      algorithm: form.algorithm.trim() || 'SHA256',
      url: form.url.trim(),
      username: form.username.trim(),
      password: form.password,
    }]);
    setForm({ name: '', algorithm: 'SHA256', url: '', username: '', password: '' });
    setShowAdd(false);
  };

  const removeSelected = () => {
    if (!selected.size) return;
    setPools((previous) => previous.filter((pool) => !selected.has(pool.id)));
    setSelected(new Set());
  };

  const pingPools = async () => {
    if (!pools.length || pinging) return;
    setPinging(true);
    try {
      const res = await fetch('/api/pools/ping', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ urls: pools.map((pool) => pool.url) }),
      });
      if (!res.ok) return;
      const { results } = await res.json() as { results: Record<string, number | null> };
      setPools((previous) => previous.map((pool) => ({
        ...pool,
        ping: pool.url in results ? results[pool.url] : pool.ping,
      })));
    } catch { /* ignore */ }
    finally { setPinging(false); }
  };

  const allVisibleSelected = paginated.length > 0 && paginated.every((pool) => selected.has(pool.id));
  const selectVisible = () => {
    const next = new Set(selected);
    if (allVisibleSelected) {
      paginated.forEach((pool) => next.delete(pool.id));
    } else {
      paginated.forEach((pool) => next.add(pool.id));
    }
    setSelected(next);
  };

  return (
    <>
      <Head><title>Pools · FindMyMiners</title></Head>

      {/* Dense KPI Row */}
      <section className="grid grid-cols-2 xl:grid-cols-3 gap-4">
        <div className="nova-glass p-4 flex flex-col justify-between transition-transform hover:-translate-y-[1px]">
          <div className="text-[10px] uppercase tracking-widest text-slate-400 font-semibold mb-3 flex items-center gap-2">
            <ShieldCheck className="w-3.5 h-3.5 text-btc-500" /> Pools enregistrés
          </div>
          <div className="font-mono text-3xl text-slate-100 font-bold tracking-tight">{pools.length}</div>
          <div className="text-[11px] font-mono text-slate-500 mt-2">Endpoints primaires, secours & test</div>
        </div>

        <div className="nova-glass p-4 flex flex-col justify-between transition-transform hover:-translate-y-[1px]">
          <div className="text-[10px] uppercase tracking-widest text-slate-400 font-semibold mb-3 flex items-center gap-2">
            <TimerReset className="w-3.5 h-3.5 text-btc-500" /> Latence moyenne
          </div>
          <div className={`font-mono text-3xl font-bold tracking-tight flex items-baseline gap-1 ${
            avgLatency == null ? 'text-slate-100' : avgLatency < 50 ? 'text-emerald-400' : avgLatency < 100 ? 'text-amber-400' : 'text-rose-400'
          }`}>
            {avgLatency == null ? '—' : avgLatency} <span className="text-xs text-slate-500 font-sans tracking-normal">ms</span>
          </div>
          <div className="text-[11px] font-mono text-slate-500 mt-2">
            {measuredPools ? `${measuredPools} endpoint${measuredPools > 1 ? 's' : ''} mesuré${measuredPools > 1 ? 's' : ''}` : 'Lance un ping pour mesurer'}
          </div>
        </div>

        <div className="nova-glass p-4 flex flex-col justify-between transition-transform hover:-translate-y-[1px] col-span-2 xl:col-span-1">
          <div className="text-[10px] uppercase tracking-widest text-slate-400 font-semibold mb-3 flex items-center gap-2">
            <Activity className="w-3.5 h-3.5 text-btc-500" /> Routes basse latence
          </div>
          <div className={`font-mono text-3xl font-bold tracking-tight ${fastPools > 0 ? 'text-emerald-400' : 'text-slate-100'}`}>{fastPools}</div>
          <div className="text-[11px] font-mono text-slate-500 mt-2">Sous 50 ms aller-retour</div>
        </div>
      </section>

      {/* Pool Catalog Table */}
      <div className="nova-glass flex flex-col overflow-hidden relative min-h-[420px]">

        {/* Toolbar */}
        <div className="min-h-14 flex items-center justify-between gap-3 px-5 py-2 border-b border-white/5 bg-white/[0.01] flex-wrap">
          <div className="flex items-center gap-4 flex-wrap">
            <h2 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
              <Droplet className="w-4 h-4 text-btc-500" /> Endpoints de pool
            </h2>
            <span className="hidden md:inline-flex items-center gap-3 text-[10px] font-mono text-slate-500">
              <span className="inline-flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> &lt; 50 ms</span>
              <span className="inline-flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-amber-500" /> 50–100 ms</span>
              <span className="inline-flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-rose-500" /> &gt; 100 ms</span>
            </span>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500" />
              <input
                type="text"
                value={search}
                onChange={(event) => { setSearch(event.target.value); setPage(1); }}
                placeholder="Rechercher nom, endpoint, worker..."
                className="focus-ring bg-obsidian-950 border border-white/10 rounded-md py-1 pl-8 pr-3 text-xs text-slate-200 w-48 md:w-64 placeholder:text-slate-600"
              />
            </div>
            {selected.size > 0 && (
              <button
                type="button"
                onClick={removeSelected}
                className="focus-ring text-xs font-semibold px-3 py-1.5 rounded bg-rose-500/10 text-rose-400 border border-rose-500/20 hover:bg-rose-500/20 transition-colors"
              >
                Supprimer ({selected.size})
              </button>
            )}
            <button
              type="button"
              onClick={pingPools}
              disabled={pinging || !pools.length}
              className="focus-ring text-xs font-semibold px-3 py-1.5 rounded bg-white/5 border border-white/10 text-slate-300 hover:text-white hover:bg-white/10 transition-colors disabled:opacity-50 flex items-center gap-1.5"
            >
              <Activity className="w-3.5 h-3.5 text-btc-500" />
              {pinging ? 'Mesure...' : 'Ping des pools'}
            </button>
            <button
              type="button"
              onClick={() => setShowAdd(true)}
              className="focus-ring text-xs font-semibold px-3 py-1.5 rounded bg-white text-obsidian-950 hover:bg-slate-200 transition-colors active:scale-95 flex items-center gap-1.5"
            >
              <Plus className="w-3.5 h-3.5" strokeWidth={3} />
              Ajouter un pool
            </button>
          </div>
        </div>

        {/* Table */}
        <div className="flex-1 overflow-auto relative max-h-[560px]">
          <table className="nova-table w-full text-left font-mono text-xs whitespace-nowrap">
            <thead className="text-[10px] uppercase tracking-wider text-slate-500 sticky top-0 z-10">
              <tr>
                <th className="py-3 px-4 w-10 font-semibold">
                  <input
                    type="checkbox"
                    checked={allVisibleSelected}
                    onChange={selectVisible}
                    className="cursor-pointer accent-[#FF9900]"
                    aria-label="Sélectionner les pools visibles"
                  />
                </th>
                {COLS.map((column) => (
                  <th key={column.key} className={`py-3 px-4 font-semibold ${column.key === 'ping' ? 'text-right' : ''}`}>
                    {column.sortable ? (
                      <button
                        type="button"
                        onClick={() => toggleSort(column.key)}
                        className="focus-ring inline-flex items-center gap-1 uppercase tracking-wider hover:text-slate-300 transition-colors"
                      >
                        {column.label}
                        {sortKey === column.key
                          ? (sortDir === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />)
                          : <ChevronUp className="w-3 h-3 opacity-25" />}
                      </button>
                    ) : column.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.03]">
              {paginated.length === 0 ? (
                <tr>
                  <td colSpan={COLS.length + 1} className="py-24 text-center">
                    <div className="inline-flex items-center justify-center w-12 h-12 rounded-full border border-dashed border-slate-600 mb-4 bg-obsidian-950">
                      <Orbit className="w-5 h-5 text-slate-500" />
                    </div>
                    <h3 className="text-slate-300 font-sans font-semibold mb-1 text-sm">
                      {search ? 'Aucun pool ne correspond à cette recherche' : 'Aucun endpoint de pool'}
                    </h3>
                    <p className="text-slate-500 font-sans text-xs mb-4">
                      {search ? 'Essaie une requête plus large ou efface le filtre.' : 'Ajoute tes endpoints de minage principaux ou de secours pour constituer un catalogue réutilisable.'}
                    </p>
                    {!search && (
                      <button
                        type="button"
                        onClick={() => setShowAdd(true)}
                        className="focus-ring bg-white text-obsidian-950 font-sans font-semibold text-xs px-4 py-2 rounded shadow hover:bg-slate-200 transition-colors active:scale-95"
                      >
                        Ajouter le premier pool
                      </button>
                    )}
                  </td>
                </tr>
              ) : paginated.map((pool) => (
                <tr key={pool.id} className="hover:bg-white/[0.02] transition-colors group">
                  <td className="py-3 px-4">
                    <input
                      type="checkbox"
                      checked={selected.has(pool.id)}
                      onChange={(event) => {
                        const next = new Set(selected);
                        if (event.target.checked) next.add(pool.id); else next.delete(pool.id);
                        setSelected(next);
                      }}
                      className="cursor-pointer accent-[#FF9900]"
                      aria-label={`Sélectionner ${pool.name}`}
                    />
                  </td>
                  <td className="py-3 px-4">
                    <div className="flex items-center gap-2">
                      <CoinIcon coin={guessCoin(pool)} size={16} />
                      <div>
                        <div className="text-slate-200 font-medium font-sans">{pool.name}</div>
                        <div className="text-[10px] text-slate-500">Profil d&apos;endpoint réutilisable</div>
                      </div>
                    </div>
                  </td>
                  <td className="py-3 px-4 text-slate-400">{pool.algorithm}</td>
                  <td className="py-3 px-4">
                    <span className="text-slate-300 break-all whitespace-normal">{pool.url}</span>
                  </td>
                  <td className="py-3 px-4 text-slate-400">{pool.username || '—'}</td>
                  <td className="py-3 px-4 text-slate-500 tracking-widest">
                    {pool.password ? '•'.repeat(Math.min(pool.password.length, 8)) : '—'}
                  </td>
                  <td className="py-3 px-4 text-right">
                    {(() => {
                      const meta = latencyMeta(pool.ping);
                      return (
                        <span className={`inline-flex items-center gap-1.5 font-mono font-semibold text-[11px] ${meta.text}`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${meta.dot}`} />
                          {meta.label}
                        </span>
                      );
                    })()}
                  </td>
                  <td className="py-3 px-4 text-right">
                    <button
                      type="button"
                      onClick={() => void openApplyModal(pool)}
                      className="focus-ring inline-flex items-center gap-1.5 text-[11px] font-sans font-semibold px-2.5 py-1.5 rounded bg-btc-500/10 text-btc-500 border border-btc-500/25 hover:bg-btc-500/20 transition-colors"
                      title="Pousser ce pool sur des mineurs de la flotte"
                    >
                      <Send className="w-3 h-3" /> Appliquer
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination Footer */}
        {sorted.length > 0 && (
          <div className="flex items-center justify-between gap-3 px-5 py-3 border-t border-white/5 bg-white/[0.01] flex-wrap font-mono text-[11px] text-slate-500">
            <span>
              {(currentPage - 1) * rowsPerPage + (paginated.length ? 1 : 0)}–{(currentPage - 1) * rowsPerPage + paginated.length} sur {sorted.length}
            </span>
            <div className="flex items-center gap-3 flex-wrap">
              <label className="inline-flex items-center gap-2">
                Lignes
                <select
                  value={rowsPerPage}
                  onChange={(event) => { setRowsPerPage(Number(event.target.value)); setPage(1); }}
                  className="focus-ring bg-obsidian-950 border border-white/10 rounded py-1 px-2 text-[11px] text-slate-300"
                >
                  {ROW_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
                </select>
              </label>
              <span>Page {currentPage} / {totalPages}</span>
              <div className="inline-flex gap-1">
                {[
                  { icon: ChevronsLeft, onClick: () => setPage(1), disabled: currentPage === 1 },
                  { icon: ChevronLeft, onClick: () => setPage((value) => Math.max(1, value - 1)), disabled: currentPage === 1 },
                  { icon: ChevronRight, onClick: () => setPage((value) => Math.min(totalPages, value + 1)), disabled: currentPage === totalPages },
                  { icon: ChevronsRight, onClick: () => setPage(totalPages), disabled: currentPage === totalPages },
                ].map(({ icon: Icon, onClick, disabled }, index) => (
                  <button
                    key={index}
                    type="button"
                    onClick={onClick}
                    disabled={disabled}
                    className="focus-ring w-7 h-7 rounded border border-white/10 bg-white/5 grid place-items-center text-slate-400 hover:text-white hover:bg-white/10 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <Icon className="w-3.5 h-3.5" />
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Add Pool Modal */}
      {showAdd && (
        <div
          className="fixed inset-0 z-[80] bg-obsidian-950/85 backdrop-blur-lg grid place-items-center p-5"
          onClick={() => setShowAdd(false)}
          role="presentation"
        >
          <div
            onClick={(event) => event.stopPropagation()}
            className="w-full max-w-[680px] bg-obsidian-900 border border-white/10 rounded-xl shadow-[0_40px_120px_rgba(0,0,0,0.7),0_0_80px_-30px_rgba(255,153,0,0.25)] overflow-hidden"
            role="dialog"
            aria-label="Ajouter un pool"
          >
            {/* Barre d'accent */}
            <div className="h-1 bg-gradient-to-r from-btc-700 via-btc-500 to-btc-700" />

            {/* En-tête */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-white/5 bg-white/[0.01]">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-btc-500/10 border border-btc-500/25 flex items-center justify-center shrink-0">
                  <Droplet className="w-5 h-5 text-btc-500" />
                </div>
                <div>
                  <h2 className="text-base font-semibold text-slate-100 m-0 leading-tight">Ajouter un pool</h2>
                  <p className="text-[11px] text-slate-500 font-sans m-0">
                    Choisis un pool vérifié — latence mesurée en direct — ou saisis ton endpoint
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowAdd(false)}
                className="focus-ring p-1.5 text-slate-500 hover:text-white rounded-lg hover:bg-white/5 transition-colors"
                aria-label="Fermer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="px-6 pt-5">
              <div className="flex items-center justify-between mb-3">
                <div className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold">
                  Pools solo vérifiés <span className="text-btc-500">· FR & 0 % d&apos;abord</span>
                </div>
                <span className="inline-flex items-center gap-3 text-[9px] font-mono text-slate-500">
                  <span className="inline-flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> &lt; 50 ms</span>
                  <span className="inline-flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-amber-500" /> 50–100</span>
                  <span className="inline-flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-rose-500" /> &gt; 100</span>
                </span>
              </div>
              <div className="grid gap-2 max-h-72 overflow-y-auto pr-1">
                {KNOWN_SOLO_POOLS.map((preset) => {
                  const selected = form.url === preset.url;
                  return (
                    <button
                      key={preset.url}
                      type="button"
                      onClick={() => setForm((current) => ({
                        ...current,
                        name: preset.name,
                        algorithm: 'SHA256',
                        url: preset.url,
                        password: current.password || 'x',
                      }))}
                      className={`focus-ring w-full flex items-center gap-3 px-3 py-2.5 rounded-lg border text-left transition-all hover:-translate-y-px ${
                        selected
                          ? 'bg-btc-500/15 border-btc-500/40 shadow-[0_0_20px_-8px_rgba(255,153,0,0.4)]'
                          : preset.featured
                            ? 'bg-btc-500/5 border-btc-500/20 hover:bg-btc-500/10 hover:border-btc-500/30'
                            : 'bg-white/[0.02] border-white/5 hover:bg-white/[0.05] hover:border-white/10'
                      }`}
                    >
                      <CoinIcon coin={preset.coin} size={20} />
                      <span className={`text-[9px] font-mono font-bold px-1.5 py-1 rounded border shrink-0 ${
                        preset.region === 'FR'
                          ? 'bg-btc-500/10 text-btc-500 border-btc-500/25'
                          : preset.region === 'EU'
                            ? 'bg-blue-500/10 text-blue-400 border-blue-500/20'
                            : 'bg-slate-500/10 text-slate-400 border-slate-500/20'
                      }`}>
                        {preset.region}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-[13px] font-sans font-semibold text-slate-100 truncate">
                          {preset.name}
                          {preset.badge && (
                            <span className={`ml-2 align-middle text-[8px] font-mono font-bold px-1.5 py-0.5 rounded border ${
                              preset.badge.tone === 'emerald'
                                ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/25'
                                : 'bg-btc-500/15 text-btc-500 border-btc-500/30'
                            }`}>
                              {preset.badge.label}
                            </span>
                          )}
                        </span>
                        <span className="block text-[10.5px] text-slate-500 font-sans truncate mt-0.5">{preset.note}</span>
                      </span>
                      <span className="shrink-0 flex flex-col items-end gap-1">
                        <span className="text-[10px] font-mono font-semibold text-slate-400">frais {preset.fees}</span>
                        {(() => {
                          const ping = preset.url in presetPings ? presetPings[preset.url] : undefined;
                          if (ping === undefined) {
                            return <span className="text-[10px] font-mono text-slate-600 animate-pulse">mesure···</span>;
                          }
                          const meta = latencyMeta(ping);
                          return (
                            <span className={`inline-flex items-center gap-1.5 text-[11px] font-mono font-bold ${meta.text}`}>
                              <span className={`w-1.5 h-1.5 rounded-full ${meta.dot}`} />
                              {ping === null ? 'HS' : `${ping} ms`}
                            </span>
                          );
                        })()}
                      </span>
                    </button>
                  );
                })}
              </div>
              <p className="text-[10px] text-slate-600 font-sans mt-2.5 mb-0">
                Latences mesurées depuis ton serveur à l&apos;instant. Vérifie l&apos;URL et les frais sur le site officiel du pool avant de miner.
              </p>
            </div>
            <div className="px-6 py-5 grid grid-cols-2 gap-4">
              {[
                { key: 'name', label: 'Nom du profil', placeholder: 'Endpoint solo principal' },
                { key: 'algorithm', label: 'Algorithme', placeholder: 'SHA256' },
                { key: 'url', label: 'URL de l’endpoint', placeholder: 'stratum+tcp://pool.exemple.com:3333', full: true },
                { key: 'username', label: 'Wallet / Worker', placeholder: 'wallet.worker1', full: true },
                { key: 'password', label: 'Mot de passe', placeholder: 'x', full: true },
              ].map(({ key, label, placeholder, full }) => (
                <label key={key} className={`grid gap-1.5 ${full ? 'col-span-2' : ''}`}>
                  <span className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">{label}</span>
                  <input
                    value={(form as Record<string, string>)[key]}
                    onChange={(event) => setForm((current) => ({ ...current, [key]: event.target.value }))}
                    placeholder={placeholder}
                    className="focus-ring bg-obsidian-950 border border-white/10 rounded-lg py-2.5 px-3.5 text-xs font-mono text-slate-200 placeholder:text-slate-600 transition-colors focus:border-btc-500/40"
                  />
                </label>
              ))}
            </div>
            <div className="flex items-center justify-between gap-3 px-6 py-4 border-t border-white/5 bg-white/[0.01]">
              <span className="text-[10px] text-slate-600 font-mono">
                {form.url.trim() ? form.url : 'Aucun endpoint sélectionné'}
              </span>
              <div className="flex gap-2.5">
                <button
                  type="button"
                  onClick={() => setShowAdd(false)}
                  className="focus-ring text-xs font-semibold px-5 py-2.5 rounded-lg bg-white/5 border border-white/10 text-slate-300 hover:text-white hover:bg-white/10 transition-colors"
                >
                  Annuler
                </button>
                <button
                  type="button"
                  onClick={addPool}
                  disabled={!form.url.trim()}
                  className="focus-ring text-xs font-bold px-5 py-2.5 rounded-lg bg-btc-500 text-obsidian-950 hover:bg-btc-400 transition-all active:scale-95 disabled:opacity-40 shadow-[0_4px_20px_-4px_rgba(255,153,0,0.4)]"
                >
                  Enregistrer le pool
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal « Appliquer aux mineurs » */}
      {applyPool && (
        <div
          className="fixed inset-0 z-[80] bg-obsidian-950/85 backdrop-blur-lg grid place-items-center p-5"
          onClick={() => { if (!applyBusy) setApplyPool(null); }}
          role="presentation"
        >
          <div
            onClick={(event) => event.stopPropagation()}
            className="w-full max-w-[560px] bg-obsidian-900 border border-white/10 rounded-xl shadow-[0_40px_120px_rgba(0,0,0,0.7),0_0_80px_-30px_rgba(255,153,0,0.25)] overflow-hidden"
            role="dialog"
            aria-label="Appliquer le pool aux mineurs"
          >
            <div className="h-1 bg-gradient-to-r from-btc-700 via-btc-500 to-btc-700" />
            <div className="flex items-center justify-between px-6 py-4 border-b border-white/5 bg-white/[0.01]">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-10 h-10 rounded-lg bg-btc-500/10 border border-btc-500/25 flex items-center justify-center shrink-0">
                  <Send className="w-4.5 h-4.5 text-btc-500" />
                </div>
                <div className="min-w-0">
                  <h2 className="text-base font-semibold text-slate-100 m-0 leading-tight truncate flex items-center gap-2">
                    <CoinIcon coin={guessCoin(applyPool)} size={16} /> Appliquer « {applyPool.name} »
                  </h2>
                  <p className="text-[11px] text-slate-500 font-mono m-0 truncate">{applyPool.url}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => { if (!applyBusy) setApplyPool(null); }}
                className="focus-ring p-1.5 text-slate-500 hover:text-white rounded-lg hover:bg-white/5 transition-colors shrink-0"
                aria-label="Fermer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="px-6 py-5 space-y-4">
              <label className="grid gap-1.5">
                <span className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">Wallet / Worker poussé sur les mineurs</span>
                <input
                  value={applyWorker}
                  onChange={(event) => setApplyWorker(event.target.value)}
                  placeholder="wallet.worker1"
                  className="focus-ring bg-obsidian-950 border border-white/10 rounded-lg py-2.5 px-3.5 text-xs font-mono text-slate-200 placeholder:text-slate-600 focus:border-btc-500/40"
                />
              </label>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">
                    Mineurs cibles ({applySelected.size}/{applyTargets.length})
                  </span>
                  <button
                    type="button"
                    onClick={() => setApplySelected(applySelected.size === applyTargets.length ? new Set() : new Set(applyTargets.map((m) => m.id)))}
                    className="focus-ring text-[10px] font-semibold text-btc-500 hover:text-white transition-colors"
                  >
                    {applySelected.size === applyTargets.length ? 'Tout décocher' : 'Tout cocher'}
                  </button>
                </div>
                <div className="grid gap-1 max-h-48 overflow-y-auto pr-1">
                  {applyTargets.length === 0 && (
                    <div className="text-xs text-slate-600 font-sans py-2">Chargement des mineurs...</div>
                  )}
                  {applyTargets.map((miner) => {
                    const checked = applySelected.has(miner.id);
                    const result = applyResults?.find((r) => r.minerId === miner.id);
                    return (
                      <label
                        key={miner.id}
                        className={`flex items-center gap-2.5 px-2.5 py-2 rounded-lg border cursor-pointer transition-colors ${
                          checked ? 'bg-btc-500/5 border-btc-500/20' : 'bg-white/[0.02] border-white/5 hover:bg-white/[0.04]'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(event) => {
                            const next = new Set(applySelected);
                            if (event.target.checked) next.add(miner.id); else next.delete(miner.id);
                            setApplySelected(next);
                          }}
                          className="cursor-pointer accent-[#FF9900]"
                        />
                        {miner.online !== undefined && (
                          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${miner.online ? 'bg-emerald-500 dot-glow-emerald' : 'bg-slate-600'}`} />
                        )}
                        <span className="text-xs font-sans font-medium text-slate-200 truncate flex-1">
                          {miner.name} {miner.model && <span className="text-slate-500 font-normal">· {miner.model}</span>}
                        </span>
                        {result && (
                          result.ok ? (
                            <span className="inline-flex items-center gap-1 text-[10px] font-mono text-emerald-400 shrink-0">
                              <CheckCircle2 className="w-3 h-3" /> {result.queued ? 'En file (agent)' : 'OK'}
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-[10px] font-mono text-rose-400 shrink-0" title={result.error}>
                              <AlertCircle className="w-3 h-3" /> Échec
                            </span>
                          )
                        )}
                      </label>
                    );
                  })}
                </div>
              </div>

              <p className="text-[10px] text-amber-400/80 font-sans m-0">
                ⚠ Chaque mineur redémarre pour appliquer le nouveau pool — quelques secondes d&apos;interruption du hash.
              </p>
            </div>

            <div className="flex justify-end gap-2.5 px-6 py-4 border-t border-white/5 bg-white/[0.01]">
              <button
                type="button"
                onClick={() => setApplyPool(null)}
                disabled={applyBusy}
                className="focus-ring text-xs font-semibold px-5 py-2.5 rounded-lg bg-white/5 border border-white/10 text-slate-300 hover:text-white hover:bg-white/10 transition-colors disabled:opacity-50"
              >
                {applyResults ? 'Fermer' : 'Annuler'}
              </button>
              <button
                type="button"
                onClick={() => void runApply()}
                disabled={applyBusy || !applySelected.size || !applyWorker.trim()}
                className="focus-ring text-xs font-bold px-5 py-2.5 rounded-lg bg-btc-500 text-obsidian-950 hover:bg-btc-400 transition-all active:scale-95 disabled:opacity-40 shadow-[0_4px_20px_-4px_rgba(255,153,0,0.4)] inline-flex items-center gap-2"
              >
                {applyBusy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                {applyBusy ? 'Application...' : `Appliquer sur ${applySelected.size} mineur${applySelected.size > 1 ? 's' : ''}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
