import { useState, useEffect, useMemo } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { Bell, Search, ChevronLeft, ChevronRight, Download } from 'lucide-react';
import { formatTime } from '@/lib/format';
import { exportCsv } from '@/lib/export-csv';
import { getPollCache, setPollCache } from '@/lib/use-smart-polling';
import { useT, useLang } from '@/lib/i18n';

type AlertEvent = {
  ts: number;
  type: 'thermal' | 'hashrate-drop' | 'pool-down' | 'anomaly' | 'daily-report' | 'maintenance';
  minerId: string;
  minerName: string;
  message: string;
  resolved?: boolean;
};

const TYPE_META: Record<string, { label: string; labelEn: string; chip: string; dot: string }> = {
  thermal: { label: 'THERMIQUE', labelEn: 'THERMAL', chip: 'bg-rose-500/10 text-rose-400 border-rose-500/20', dot: 'bg-rose-500 dot-glow-rose' },
  'pool-down': { label: 'POOL HS', labelEn: 'POOL DOWN', chip: 'bg-rose-500/10 text-rose-400 border-rose-500/20', dot: 'bg-rose-500 dot-glow-rose' },
  'hashrate-drop': { label: 'HASHRATE', labelEn: 'HASHRATE', chip: 'bg-amber-500/10 text-amber-500 border-amber-500/20', dot: 'bg-amber-500 dot-glow-amber' },
  anomaly: { label: 'ANOMALIE', labelEn: 'ANOMALY', chip: 'bg-btc-500/10 text-btc-500 border-btc-500/20', dot: 'bg-btc-500 dot-glow-btc' },
  'daily-report': { label: 'RAPPORT', labelEn: 'REPORT', chip: 'bg-blue-500/10 text-blue-400 border-blue-500/20', dot: 'bg-blue-500' },
  maintenance: { label: 'MAINTENANCE', labelEn: 'MAINTENANCE', chip: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20', dot: 'bg-emerald-500 dot-glow-emerald' },
};

const ALL_TYPES = Object.keys(TYPE_META);
const ROWS_PER_PAGE = 25;

export default function AlertsPage() {
  const t = useT();
  const { lang } = useLang();
  const [events, setEvents] = useState<AlertEvent[]>(() => getPollCache<AlertEvent[]>('alerts-history') ?? []);
  const [loading, setLoading] = useState(() => getPollCache('alerts-history') === null);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<string | null>(null);
  const [page, setPage] = useState(1);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/alerts/history?limit=1000');
        if (!res.ok) return;
        const data = await res.json();
        setPollCache('alerts-history', data.events || []);
        setEvents(data.events || []);
      } catch { /* ignore */ }
      setLoading(false);
    })();
  }, []);

  const filtered = useMemo(() => {
    let list = events;
    if (typeFilter) list = list.filter((event) => event.type === typeFilter);
    if (search) {
      const query = search.toLowerCase();
      list = list.filter((event) => event.minerName.toLowerCase().includes(query) || event.message.toLowerCase().includes(query));
    }
    return list;
  }, [events, typeFilter, search]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / ROWS_PER_PAGE));
  const currentPage = Math.min(page, totalPages);
  const paginated = filtered.slice((currentPage - 1) * ROWS_PER_PAGE, currentPage * ROWS_PER_PAGE);

  const typeCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const event of events) counts[event.type] = (counts[event.type] || 0) + 1;
    return counts;
  }, [events]);

  const criticalCount = events.filter((event) => event.type === 'thermal' || event.type === 'pool-down').length;
  const resolvedCount = events.filter((event) => event.resolved).length;
  const unresolvedCount = Math.max(events.length - resolvedCount, 0);

  return (
    <>
      <Head><title>{t('Alertes', 'Alerts')} · FindMyMiners</title></Head>

      {/* Dense KPI Row */}
      <section className="grid grid-cols-3 gap-4">
        <div className="nova-glass p-4 flex flex-col justify-between transition-transform hover:-translate-y-[1px]">
          <div className="text-[10px] uppercase tracking-widest text-slate-400 font-semibold mb-3">{t('Événements critiques', 'Critical events')}</div>
          <div className={`font-mono text-3xl font-bold tracking-tight ${criticalCount > 0 ? 'text-rose-500 glow-rose' : 'text-slate-100'}`}>{criticalCount}</div>
          <div className="text-[11px] font-mono text-slate-500 mt-2">{t('Incidents thermiques & pool', 'Thermal & pool incidents')}</div>
        </div>
        <div className="nova-glass p-4 flex flex-col justify-between transition-transform hover:-translate-y-[1px]">
          <div className="text-[10px] uppercase tracking-widest text-slate-400 font-semibold mb-3">{t('À traiter', 'To handle')}</div>
          <div className="font-mono text-3xl text-slate-100 font-bold tracking-tight">{unresolvedCount}</div>
          <div className="text-[11px] font-mono text-slate-500 mt-2">{t('Événements à examiner', 'Events to review')}</div>
        </div>
        <div className="nova-glass p-4 flex flex-col justify-between transition-transform hover:-translate-y-[1px]">
          <div className="text-[10px] uppercase tracking-widest text-slate-400 font-semibold mb-3">{t('Total événements', 'Total events')}</div>
          <div className="font-mono text-3xl text-slate-100 font-bold tracking-tight">{events.length}</div>
          <div className="text-[11px] font-mono text-slate-500 mt-2">{t('1000 derniers enregistrements', 'Last 1000 records')}</div>
        </div>
      </section>

      {/* Incident Stream */}
      <div className="nova-glass flex flex-col overflow-hidden relative min-h-[420px]">

        {/* Toolbar: filters + search + export */}
        <div className="flex items-center justify-between gap-3 px-5 py-3 border-b border-white/5 bg-white/[0.01] flex-wrap">
          <div className="flex items-center gap-1.5 flex-wrap">
            <button
              type="button"
              onClick={() => { setTypeFilter(null); setPage(1); }}
              className={`focus-ring text-[10px] font-mono font-semibold px-2 py-1 rounded border transition-colors ${
                !typeFilter
                  ? 'bg-white/10 text-slate-100 border-white/20'
                  : 'bg-white/[0.02] text-slate-500 border-white/5 hover:text-slate-300'
              }`}
            >
              {t('TOUS', 'ALL')} ({events.length})
            </button>
            {ALL_TYPES.map((type) => {
              const meta = TYPE_META[type];
              const active = typeFilter === type;
              const count = typeCounts[type] || 0;
              return (
                <button
                  key={type}
                  type="button"
                  onClick={() => { setTypeFilter(active ? null : type); setPage(1); }}
                  className={`focus-ring text-[10px] font-mono font-semibold px-2 py-1 rounded border transition-colors ${
                    active ? meta.chip : 'bg-white/[0.02] text-slate-500 border-white/5 hover:text-slate-300'
                  }`}
                >
                  {t(meta.label, meta.labelEn)} ({count})
                </button>
              );
            })}
          </div>
          <div className="flex items-center gap-3">
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500" />
              <input
                type="text"
                value={search}
                onChange={(event) => { setSearch(event.target.value); setPage(1); }}
                placeholder={t('Rechercher mineur ou message...', 'Search miner or message...')}
                className="focus-ring bg-obsidian-950 border border-white/10 rounded-md py-1 pl-8 pr-3 text-xs text-slate-200 w-48 md:w-64 placeholder:text-slate-600"
              />
            </div>
            <button
              type="button"
              onClick={() => exportCsv(
                filtered.map((e) => ({ time: new Date(e.ts).toISOString(), type: e.type, miner: e.minerName, message: e.message })),
                'alerts-export.csv',
                [{ key: 'time', label: 'Time' }, { key: 'type', label: 'Type' }, { key: 'miner', label: 'Miner' }, { key: 'message', label: 'Message' }],
              )}
              disabled={filtered.length === 0}
              className="focus-ring text-xs font-semibold px-3 py-1.5 rounded bg-white/5 border border-white/10 text-slate-300 hover:text-white hover:bg-white/10 transition-colors disabled:opacity-50 flex items-center gap-1.5"
            >
              <Download className="w-3.5 h-3.5" /> {t('Exporter CSV', 'Export CSV')}
            </button>
          </div>
        </div>

        {/* Event list */}
        <div className="flex-1 overflow-auto px-5">
          {loading ? (
            <div className="py-4 space-y-3">
              {[0, 1, 2, 3, 4].map((index) => (
                <div key={index} className="nova-shimmer h-12 rounded" />
              ))}
            </div>
          ) : paginated.length === 0 ? (
            <div className="py-24 text-center">
              <div className="inline-flex items-center justify-center w-12 h-12 rounded-full border border-dashed border-slate-600 mb-4 bg-obsidian-950">
                <Bell className="w-5 h-5 text-slate-500" />
              </div>
              <h3 className="text-slate-300 font-sans font-semibold mb-1 text-sm">
                {search || typeFilter ? t('Aucune alerte correspondante', 'No matching alert') : t('Tout va bien', 'All good')}
              </h3>
              <p className="text-slate-500 font-sans text-xs mb-4 max-w-sm mx-auto">
                {search || typeFilter
                  ? t('Essaie un autre filtre ou une autre recherche.', 'Try another filter or search.')
                  : t('Ta flotte fonctionne normalement. Les alertes apparaîtront ici en cas d’anomalie de température, de hashrate ou de connectivité.', 'Your fleet is running normally. Alerts will appear here on temperature, hashrate or connectivity anomalies.')}
              </p>
              {!search && !typeFilter && (
                <Link
                  href="/settings?tab=general"
                  className="focus-ring inline-block bg-white text-obsidian-950 font-sans font-semibold text-xs px-4 py-2 rounded shadow hover:bg-slate-200 transition-colors"
                >
                  {t('Configurer les seuils d’alerte', 'Configure alert thresholds')}
                </Link>
              )}
            </div>
          ) : (
            <div className="divide-y divide-white/[0.03]">
              {paginated.map((event, index) => {
                const meta = TYPE_META[event.type] || TYPE_META.anomaly;
                return (
                  <div key={`${event.ts}-${index}`} className="flex gap-3 py-3">
                    <div className="mt-1.5"><div className={`w-1.5 h-1.5 rounded-full ${meta.dot}`} /></div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <span className="text-sm font-sans font-semibold text-slate-200">{event.minerName}</span>
                        <span className={`text-[9px] font-mono font-semibold border px-1 py-0.5 rounded ${meta.chip}`}>{t(meta.label, meta.labelEn)}</span>
                        {event.resolved && (
                          <span className="text-[9px] font-mono font-semibold border px-1 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border-emerald-500/20">{t('RÉSOLU', 'RESOLVED')}</span>
                        )}
                        <span className="text-[10px] text-slate-500 font-mono ml-auto shrink-0">{formatTime(event.ts, lang)}</span>
                      </div>
                      <p className="text-xs text-slate-400 font-sans m-0">{event.message}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between gap-3 px-5 py-3 border-t border-white/5 bg-white/[0.01] font-mono text-[11px] text-slate-500">
            <span>
              {(currentPage - 1) * ROWS_PER_PAGE + 1}–{(currentPage - 1) * ROWS_PER_PAGE + paginated.length} {t('sur', 'of')} {filtered.length}
            </span>
            <div className="flex items-center gap-3">
              <span>{t('Page', 'Page')} {currentPage} / {totalPages}</span>
              <div className="inline-flex gap-1">
                <button
                  type="button"
                  disabled={currentPage <= 1}
                  onClick={() => setPage(currentPage - 1)}
                  className="focus-ring w-7 h-7 rounded border border-white/10 bg-white/5 grid place-items-center text-slate-400 hover:text-white hover:bg-white/10 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  disabled={currentPage >= totalPages}
                  onClick={() => setPage(currentPage + 1)}
                  className="focus-ring w-7 h-7 rounded border border-white/10 bg-white/5 grid place-items-center text-slate-400 hover:text-white hover:bg-white/10 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
