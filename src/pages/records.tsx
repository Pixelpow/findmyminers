import { useEffect, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { Crown, Medal, Trophy, Activity, Orbit, ArrowUpRight } from 'lucide-react';
import { formatDiff, formatDate } from '@/lib/format';
import { getPollCache, setPollCache } from '@/lib/use-smart-polling';
import { useT } from '@/lib/i18n';

type GlobalRecord = {
  bestDiff: number;
  bestDiffAt: number | null;
  bestDiffMinerId: string | null;
  bestDiffMinerName: string | null;
  bestDiffAccountKey: string | null;
  bestDiffPoolUrl: string | null;
  lastDiff: number;
  lastDiffAt: number | null;
};

type TopMiner = {
  minerId: string;
  minerName: string;
  bestDiff: number;
  bestDiffAt: number | null;
  bestDiffAccountKey: string | null;
  lastDiff: number;
};

type TopAccount = {
  accountKey: string;
  bestDiff: number;
  bestDiffAt: number | null;
  lastDiff: number;
  minerCount: number;
  minerName: string | null;
  minerId: string | null;
};

type RecentAccountRecord = {
  accountKey: string;
  bestDiff: number;
  lastDiff: number;
  updatedAt: number;
  poolUrl: string | null;
};

type RecordsPayload = {
  globalRecord: GlobalRecord | null;
  topMiners: TopMiner[];
  topAccounts: TopAccount[];
  recentAccountRecords: RecentAccountRecord[];
};

/** Médaille de classement : or / argent / bronze puis neutre. */
function RankBadge({ index }: { index: number }) {
  const tones = [
    'text-btc-500 bg-btc-500/10 border-btc-500/25',
    'text-slate-300 bg-slate-400/10 border-slate-400/25',
    'text-amber-700 bg-amber-700/10 border-amber-700/30',
  ];
  const tone = tones[index] || 'text-slate-500 bg-white/[0.03] border-white/10';
  return (
    <div className={`w-8 h-8 rounded grid place-items-center font-mono font-bold text-xs border shrink-0 ${tone}`}>
      {index + 1}
    </div>
  );
}

function PanelHeader({ icon: Icon, title, right }: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  right?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between mb-4">
      <h3 className="text-xs uppercase tracking-wider text-slate-400 font-semibold flex items-center gap-2">
        <Icon className="w-4 h-4 text-btc-500" /> {title}
      </h3>
      {right}
    </div>
  );
}

export default function RecordsPage() {
  const router = useRouter();
  const t = useT();
  const [records, setRecords] = useState<RecordsPayload | null>(() => getPollCache<RecordsPayload>('records'));
  const loading = !records;

  useEffect(() => {
    const fetchRecords = async () => {
      try {
        const res = await fetch('/api/records');
        if (!res.ok) return;
        const json = await res.json();
        setPollCache('records', json);
        setRecords(json);
      } catch { /* ignore */ }
    };

    void fetchRecords();
    const interval = setInterval(fetchRecords, 20_000);
    return () => clearInterval(interval);
  }, []);

  const globalRecord = records?.globalRecord;
  const topMiner = records?.topMiners?.[0] || null;
  const topAccount = records?.topAccounts?.[0] || null;

  return (
    <>
      <Head><title>Records · FindMyMiners</title></Head>

      {/* Rangée KPI dense */}
      <section className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        <div className="nova-glass p-4 flex flex-col justify-between transition-transform hover:-translate-y-[1px]">
          <div className="text-[10px] uppercase tracking-widest text-btc-500 font-semibold mb-3 flex items-center gap-2">
            <Crown className="w-3.5 h-3.5" /> {t('Record flotte', 'Fleet record')}
          </div>
          <div className="font-mono text-3xl text-slate-100 font-bold tracking-tight glow-btc">{formatDiff(globalRecord?.bestDiff)}</div>
          <div className="text-[11px] font-mono text-slate-500 mt-2 truncate">
            {globalRecord?.bestDiffMinerName
              ? `${globalRecord.bestDiffMinerName} · ${globalRecord.bestDiffAccountKey || t('compte inconnu', 'unknown account')}`
              : t('En attente du premier share exceptionnel', 'Waiting for the first standout share')}
          </div>
        </div>

        <div className="nova-glass p-4 flex flex-col justify-between transition-transform hover:-translate-y-[1px]">
          <div className="text-[10px] uppercase tracking-widest text-slate-400 font-semibold mb-3 flex items-center gap-2">
            <Trophy className="w-3.5 h-3.5 text-btc-500" /> {t('Meilleur mineur', 'Best miner')}
          </div>
          <div className="font-mono text-3xl text-slate-100 font-bold tracking-tight">{formatDiff(topMiner?.bestDiff)}</div>
          <div className="text-[11px] font-mono text-slate-500 mt-2 truncate">
            {topMiner ? `${topMiner.minerName} · ${formatDate(topMiner.bestDiffAt)}` : t('Aucun record de mineur pour l’instant', 'No miner record yet')}
          </div>
        </div>

        <div className="nova-glass p-4 flex flex-col justify-between transition-transform hover:-translate-y-[1px]">
          <div className="text-[10px] uppercase tracking-widest text-slate-400 font-semibold mb-3 flex items-center gap-2">
            <Medal className="w-3.5 h-3.5 text-btc-500" /> {t('Meilleur compte', 'Best account')}
          </div>
          <div className="font-mono text-3xl text-slate-100 font-bold tracking-tight">{formatDiff(topAccount?.bestDiff)}</div>
          <div className="text-[11px] font-mono text-slate-500 mt-2 truncate">
            {topAccount ? `${topAccount.accountKey} · ${topAccount.minerCount} ${t('mineur(s)', 'miner(s)')}` : t('Aucun record de compte enregistré', 'No account record saved')}
          </div>
        </div>

        <div className="nova-glass p-4 flex flex-col justify-between transition-transform hover:-translate-y-[1px]">
          <div className="text-[10px] uppercase tracking-widest text-slate-400 font-semibold mb-3 flex items-center gap-2">
            <Activity className="w-3.5 h-3.5 text-btc-500" /> {t('Mises à jour récentes', 'Recent updates')}
          </div>
          <div className="font-mono text-3xl text-slate-100 font-bold tracking-tight">{records?.recentAccountRecords?.length || 0}</div>
          <div className="text-[11px] font-mono text-slate-500 mt-2">{t('Actualisé toutes les 20 secondes', 'Refreshed every 20 seconds')}</div>
        </div>
      </section>

      {/* Classements */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">

        {/* Top mineurs */}
        <div className="nova-glass p-5">
          <PanelHeader icon={Trophy} title={t('Top mineurs', 'Top miners')} right={<span className="text-[10px] text-slate-500 font-mono">{t('Meilleurs diffs personnels', 'Best personal diffs')}</span>} />
          <div className="divide-y divide-white/[0.03]">
            {loading && [0, 1, 2].map((i) => <div key={i} className="nova-shimmer h-11 rounded my-2" />)}
            {!loading && (records?.topMiners || []).length === 0 && (
              <div className="py-10 text-center">
                <Crown className="w-5 h-5 text-slate-600 mx-auto mb-2" />
                <div className="text-xs text-slate-500 font-sans mb-2">{t('Aucun record de mineur pour l’instant.', 'No miner record yet.')}</div>
                <Link href="/dashboard" className="focus-ring text-xs font-semibold text-btc-500 hover:text-btc-400">
                  {t('Aller au tableau de bord', 'Go to dashboard')} →
                </Link>
              </div>
            )}
            {(records?.topMiners || []).map((miner, index) => (
              <button
                key={miner.minerId}
                type="button"
                onClick={() => router.push(`/miners/${miner.minerId}`)}
                className="focus-ring w-full flex items-center gap-3 py-2.5 px-1 hover:bg-white/[0.02] transition-colors group text-left"
              >
                <RankBadge index={index} />
                <div className="min-w-0 flex-1">
                  <div className="text-sm text-slate-200 font-medium font-sans truncate">{miner.minerName}</div>
                  <div className="text-[10px] text-slate-500 font-mono truncate">
                    {miner.bestDiffAccountKey || t('compte inconnu', 'unknown account')} · {formatDate(miner.bestDiffAt)}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="font-mono text-base font-bold text-slate-200">{formatDiff(miner.bestDiff)}</span>
                  <ArrowUpRight className="w-3.5 h-3.5 text-slate-600 group-hover:text-btc-500 transition-colors" />
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Top comptes + dernier share */}
        <div className="flex flex-col gap-6">
          <div className="nova-glass p-5 flex-1">
            <PanelHeader icon={Medal} title={t('Top comptes', 'Top accounts')} right={<span className="text-[10px] text-slate-500 font-mono">{t('Classement par meilleur diff', 'Ranked by best diff')}</span>} />
            <div className="divide-y divide-white/[0.03]">
              {loading && [0, 1, 2].map((i) => <div key={i} className="nova-shimmer h-11 rounded my-2" />)}
              {!loading && (records?.topAccounts || []).length === 0 && (
                <div className="py-10 text-center">
                  <Medal className="w-5 h-5 text-slate-600 mx-auto mb-2" />
                  <div className="text-xs text-slate-500 font-sans">{t('Les records de compte apparaîtront dès que des shares seront détectés.', 'Account records will appear as soon as shares are detected.')}</div>
                </div>
              )}
              {(records?.topAccounts || []).map((account, index) => (
                <div key={account.accountKey} className="flex items-center gap-3 py-2.5 px-1">
                  <RankBadge index={index} />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm text-slate-200 font-medium font-mono truncate">{account.accountKey}</div>
                    <div className="text-[10px] text-slate-500 font-mono truncate">
                      {account.minerCount} {t('mineur(s)', 'miner(s)')} · {account.minerName || t('mineur inconnu', 'unknown miner')} · {formatDate(account.bestDiffAt)}
                    </div>
                  </div>
                  <span className="font-mono text-base font-bold text-slate-200 shrink-0">{formatDiff(account.bestDiff)}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Dernier share de la flotte */}
          <div className="nova-glass p-5">
            <PanelHeader icon={Orbit} title={t('Dernier share de la flotte', 'Fleet last share')} />
            <div className="font-mono text-2xl font-bold text-slate-100 mb-2">{formatDiff(globalRecord?.lastDiff)}</div>
            <p className="text-xs text-slate-400 font-sans m-0">
              {t('Dernier diff suivi le', 'Last diff tracked on')} {formatDate(globalRecord?.lastDiffAt)}
              {globalRecord?.bestDiffPoolUrl ? ` ${t('via', 'via')} ${globalRecord.bestDiffPoolUrl}` : ''}.
            </p>
          </div>
        </div>
      </div>

      {/* Activité récente */}
      <div className="nova-glass flex flex-col overflow-hidden">
        <div className="h-14 flex items-center justify-between px-5 border-b border-white/5 bg-white/[0.01] shrink-0">
          <h2 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
            <Activity className="w-4 h-4 text-btc-500" /> {t('Activité récente des comptes', 'Recent account activity')}
          </h2>
          <span className="text-[10px] text-slate-500 font-mono">{t('Actualisé toutes les 20 s', 'Refreshed every 20s')}</span>
        </div>
        <div className="overflow-auto max-h-[480px]">
          <table className="nova-table w-full text-left font-mono text-xs whitespace-nowrap">
            <thead className="text-[10px] uppercase tracking-wider text-slate-500 sticky top-0 z-10">
              <tr>
                <th className="py-3 px-4 font-semibold">{t('Compte', 'Account')}</th>
                <th className="py-3 px-4 font-semibold text-right">{t('Meilleur diff', 'Best diff')}</th>
                <th className="py-3 px-4 font-semibold text-right">{t('Dernier diff', 'Last diff')}</th>
                <th className="py-3 px-4 font-semibold">Pool</th>
                <th className="py-3 px-4 font-semibold text-right">{t('Mis à jour', 'Updated')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.03]">
              {loading && [0, 1, 2].map((i) => (
                <tr key={i} className="nova-shimmer">
                  <td className="py-4 px-4" colSpan={5}><div className="h-4 bg-white/5 rounded w-full" /></td>
                </tr>
              ))}
              {!loading && (records?.recentAccountRecords || []).length === 0 && (
                <tr>
                  <td colSpan={5} className="py-12 text-center text-slate-500 font-sans text-xs">
                    {t('Aucune activité de compte récente.', 'No recent account activity.')}
                  </td>
                </tr>
              )}
              {(records?.recentAccountRecords || []).map((row) => (
                <tr key={`${row.accountKey}-${row.updatedAt}`} className="hover:bg-white/[0.02] transition-colors">
                  <td className="py-3 px-4 text-slate-200">{row.accountKey}</td>
                  <td className="py-3 px-4 text-right font-bold text-slate-200">{formatDiff(row.bestDiff)}</td>
                  <td className="py-3 px-4 text-right text-slate-400">{formatDiff(row.lastDiff)}</td>
                  <td className="py-3 px-4 text-slate-500">{row.poolUrl || '—'}</td>
                  <td className="py-3 px-4 text-right text-slate-500">{formatDate(row.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
