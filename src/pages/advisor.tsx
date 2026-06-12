import { useMemo, useCallback } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import {
  ArrowRight,
  Flame,
  Gauge,
  Bot,
  AlertCircle,
  AlertTriangle,
  Info,
  CheckCircle2,
} from 'lucide-react';
import {
  type AdvisorFleetMiner,
  buildFleetRecommendations,
  getEfficiencyWatchlist,
  getThermalWatchlist,
} from '@/lib/advisor';
import { useSmartPolling } from '@/lib/use-smart-polling';

type FleetData = {
  fleet: AdvisorFleetMiner[];
  totals: {
    miners: number;
    online: number;
    offline: number;
    hashrateTHs: number;
    powerW: number;
    avgTempC?: number;
  };
};

function KpiSkeleton() {
  return (
    <div className="nova-glass p-5 min-h-[120px]">
      <div className="nova-shimmer h-3 w-20 rounded mb-4" />
      <div className="nova-shimmer h-8 w-24 rounded" />
    </div>
  );
}

export default function AdvisorPage() {
  const router = useRouter();

  const fetchFleet = useCallback(async () => {
    const res = await fetch('/api/miner/fleet');
    if (!res.ok) throw new Error('Fleet fetch failed');
    return await res.json() as FleetData;
  }, []);

  // Partage le cache 'fleet' avec le tableau de bord — rendu instantané.
  const { data: fleetData, refetch } = useSmartPolling(fetchFleet, { intervalMs: 20_000, cacheKey: 'fleet' });
  const loading = !fleetData;

  const fleet = useMemo(() => fleetData?.fleet ?? [], [fleetData]);
  const total = fleetData?.totals.miners ?? 0;
  const online = fleetData?.totals.online ?? 0;
  const offlineCount = Math.max(0, fleetData?.totals.offline ?? 0);
  const avgTemp = fleetData?.totals.avgTempC || 0;

  const recommendations = useMemo(() => buildFleetRecommendations(fleet, total), [fleet, total]);
  const thermalWatchlist = useMemo(() => getThermalWatchlist(fleet), [fleet]);
  const efficiencyWatchlist = useMemo(() => getEfficiencyWatchlist(fleet), [fleet]);
  const avgUptime = useMemo(() => {
    const withUptime = fleet.filter((miner) => typeof miner.stats?.uptimeRatio === 'number');
    if (!withUptime.length) return 0;
    return withUptime.reduce((sum, miner) => sum + (miner.stats?.uptimeRatio || 0), 0) / withUptime.length;
  }, [fleet]);

  const severityTone = (severity: 'critical' | 'warning' | 'info') => {
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

  const tempTone = (temp: number) =>
    temp >= 85 ? 'text-rose-500 font-bold' : temp >= 75 ? 'text-amber-400' : 'text-emerald-400';

  return (
    <>
      <Head><title>Conseiller · FindMyMiners</title></Head>

      <div className="space-y-8">

      {/* Intro discrète */}
      <p className="text-sm text-slate-500 font-sans m-0 max-w-2xl">
        Le conseiller analyse ta flotte en continu et met en avant ce qui mérite ton attention :
        surchauffe, baisse de performance, mineurs hors ligne. Pas d&apos;alerte ici = rien à faire.
      </p>

      {/* Rangée KPI */}
      <section className="grid grid-cols-2 xl:grid-cols-4 gap-5">
        {loading ? (
          <>
            <KpiSkeleton /><KpiSkeleton /><KpiSkeleton /><KpiSkeleton />
          </>
        ) : (
          <>
            <div className="nova-glass p-5 flex flex-col justify-between transition-transform hover:-translate-y-[1px]">
              <div className="text-[10px] uppercase tracking-widest text-slate-400 font-semibold mb-4">Hashrate flotte</div>
              <div className="font-mono text-3xl text-slate-100 font-bold tracking-tight flex items-baseline gap-1">
                {(fleetData?.totals.hashrateTHs || 0).toFixed(1)} <span className="text-xs text-slate-500 font-sans tracking-normal">TH/s</span>
              </div>
              <div className="text-[11px] font-mono text-slate-400 mt-3">{online} / {total} mineurs en ligne</div>
            </div>

            <div className="nova-glass p-5 flex flex-col justify-between transition-transform hover:-translate-y-[1px]">
              <div className="text-[10px] uppercase tracking-widest text-slate-400 font-semibold mb-4">Mineurs hors ligne</div>
              <div className={`font-mono text-3xl font-bold tracking-tight ${offlineCount > 0 ? 'text-rose-500 glow-rose' : 'text-slate-100'}`}>
                {offlineCount}
              </div>
              <div className="text-[11px] font-mono text-slate-400 mt-3">
                {offlineCount ? 'Détail dans les actions ci-dessous' : 'Toute la flotte répond'}
              </div>
            </div>

            <div className="nova-glass p-5 flex flex-col justify-between transition-transform hover:-translate-y-[1px]">
              <div className="text-[10px] uppercase tracking-widest text-slate-400 font-semibold mb-4">Temp moyenne</div>
              <div className={`font-mono text-3xl font-bold tracking-tight flex items-baseline gap-1 ${
                avgTemp >= 85 ? 'text-rose-500 glow-rose' : avgTemp >= 70 ? 'text-amber-400 glow-amber' : 'text-slate-100'
              }`}>
                {avgTemp > 0 ? avgTemp.toFixed(1) : '—'} <span className="text-xs font-sans tracking-normal">°C</span>
              </div>
              <div className="text-[11px] font-mono text-slate-500 mt-3">Idéal sous 70°C · critique à 85°C</div>
            </div>

            <div className="nova-glass p-5 flex flex-col justify-between transition-transform hover:-translate-y-[1px]">
              <div className="text-[10px] uppercase tracking-widest text-slate-400 font-semibold mb-4">Uptime moyen</div>
              <div className="font-mono text-3xl text-slate-100 font-bold tracking-tight flex items-baseline gap-1">
                {avgUptime ? (avgUptime * 100).toFixed(1) : '—'} <span className="text-xs text-slate-500 font-sans tracking-normal">%</span>
              </div>
              <div className="text-[11px] font-mono text-slate-500 mt-3">Temps passé en ligne sur 24h</div>
            </div>
          </>
        )}
      </section>

      {/* Actions prioritaires */}
      <div className="nova-glass p-6">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-xs uppercase tracking-wider text-slate-400 font-semibold flex items-center gap-2">
            <Bot className="w-4 h-4 text-btc-500" /> Actions prioritaires
          </h3>
          <button
            type="button"
            onClick={() => void refetch()}
            className="focus-ring text-[10px] uppercase font-semibold text-btc-500 hover:text-white transition-colors"
          >
            Relancer l&apos;analyse
          </button>
        </div>
        <p className="text-xs text-slate-500 font-sans mt-0 mb-5 max-w-2xl">
          Les problèmes détectés sur ta flotte, du plus urgent au moins urgent —
          <span className="text-rose-400"> rouge</span> : agir maintenant,
          <span className="text-amber-400"> orange</span> : à vérifier,
          <span className="text-blue-400"> bleu</span> : simple suggestion.
        </p>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3 font-sans text-sm">
          {loading && [0, 1, 2].map((i) => <div key={i} className="nova-shimmer h-24 rounded-lg" />)}
          {!loading && recommendations.length === 0 && (
            <div className="p-4 bg-emerald-500/5 border border-emerald-500/10 rounded-lg">
              <div className="flex gap-3">
                <CheckCircle2 className="w-[18px] h-[18px] text-emerald-500 shrink-0 mt-0.5" />
                <div>
                  <div className="text-slate-200 font-medium">Tout est en ordre</div>
                  <div className="text-xs text-slate-400 mt-1">Aucun problème détecté — ta flotte tourne normalement.</div>
                </div>
              </div>
            </div>
          )}
          {recommendations.map((rec) => {
            const tone = severityTone(rec.severity);
            return (
              <div key={rec.id} className={`p-4 border rounded-lg group ${tone.wrap}`}>
                <div className="flex gap-3">
                  {tone.icon}
                  <div className="min-w-0">
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

      {/* Surveillances */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-8">

        {/* Surveillance thermique */}
        <div className="nova-glass p-6">
          <h3 className="text-xs uppercase tracking-wider text-slate-400 font-semibold flex items-center gap-2 mb-2">
            <Flame className="w-4 h-4 text-btc-500" /> Surveillance thermique
          </h3>
          <p className="text-xs text-slate-500 font-sans mt-0 mb-5">
            Tes mineurs en ligne, du plus chaud au plus froid. Un mineur qui chauffe use ses composants
            et finit par brider son hashrate :
            <span className="text-emerald-400"> vert</span> = OK,
            <span className="text-amber-400"> orange</span> = à surveiller (75°C+),
            <span className="text-rose-400"> rouge</span> = trop chaud (85°C+).
          </p>
          <div className="divide-y divide-white/[0.03]">
            {loading && [0, 1, 2].map((i) => <div key={i} className="nova-shimmer h-10 rounded my-2" />)}
            {!loading && thermalWatchlist.length === 0 && (
              <div className="text-xs text-slate-500 font-sans py-2">Aucune donnée thermique pour l&apos;instant — les mineurs doivent être en ligne.</div>
            )}
            {thermalWatchlist.map((miner) => {
              const temp = miner.latest?.tempAvg || 0;
              return (
                <button
                  key={miner.id}
                  type="button"
                  onClick={() => router.push(`/miners/${miner.id}`)}
                  className="focus-ring w-full flex items-center justify-between gap-4 py-3 px-1 hover:bg-white/[0.02] transition-colors group text-left"
                >
                  <div className="min-w-0">
                    <div className="text-sm text-slate-200 font-medium font-sans truncate">{miner.name}</div>
                    <div className="text-[10px] text-slate-500 font-mono">
                      {(miner.latest?.hashrateTHs || 0).toFixed(2)} TH/s · {(miner.latest?.powerW || 0).toFixed(0)} W
                    </div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <span className={`font-mono text-base ${tempTone(temp)}`}>{temp.toFixed(0)}°C</span>
                    <ArrowRight className="w-3.5 h-3.5 text-slate-600 group-hover:text-btc-500 group-hover:translate-x-0.5 transition-all" />
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Dérive d'efficacité */}
        <div className="nova-glass p-6">
          <h3 className="text-xs uppercase tracking-wider text-slate-400 font-semibold flex items-center gap-2 mb-2">
            <Gauge className="w-4 h-4 text-btc-500" /> Dérive de performance
          </h3>
          <p className="text-xs text-slate-500 font-sans mt-0 mb-5">
            Compare le hashrate actuel de chaque mineur à sa propre moyenne des dernières 24h.
            <span className="text-slate-300"> 100&nbsp;% = il mine comme d&apos;habitude.</span> En dessous de 90&nbsp;%,
            quelque chose le freine (chaleur, pool, réglages) — en dessous de 72&nbsp;%, il faut investiguer.
          </p>
          <div className="divide-y divide-white/[0.03]">
            {loading && [0, 1, 2].map((i) => <div key={i} className="nova-shimmer h-10 rounded my-2" />)}
            {!loading && efficiencyWatchlist.length === 0 && (
              <div className="text-xs text-slate-500 font-sans py-2">Pas encore de moyenne 24h — laisse tourner la flotte quelques heures.</div>
            )}
            {efficiencyWatchlist.map(({ miner, ratio }) => {
              const pct = Math.min(100, Math.round(ratio * 100));
              const tone = ratio < 0.72 ? 'text-rose-400' : ratio < 0.9 ? 'text-amber-400' : 'text-emerald-400';
              const bar = ratio < 0.72 ? 'bg-rose-500' : ratio < 0.9 ? 'bg-amber-400' : 'bg-emerald-400';
              return (
                <button
                  key={miner.id}
                  type="button"
                  onClick={() => router.push(`/miners/${miner.id}`)}
                  className="focus-ring w-full flex items-center justify-between gap-4 py-3 px-1 hover:bg-white/[0.02] transition-colors group text-left"
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-sm text-slate-200 font-medium font-sans truncate">{miner.name}</div>
                    <div className="text-[10px] text-slate-500 font-mono">
                      Actuel {(miner.latest?.hashrateTHs || 0).toFixed(2)} vs {(miner.stats?.avgHashrate24h || 0).toFixed(2)} TH/s en moyenne
                    </div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <div className="w-16 h-1 bg-white/10 rounded-full overflow-hidden">
                      <div className={`h-full ${bar}`} style={{ width: `${pct}%` }} />
                    </div>
                    <span className={`font-mono text-sm w-10 text-right ${tone}`}>{pct}%</span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

      </div>

      </div>
    </>
  );
}
