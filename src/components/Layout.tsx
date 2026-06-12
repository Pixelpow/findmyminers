import { useRouter } from 'next/router';
import Link from 'next/link';
import { useState, useEffect } from 'react';
import {
  LayoutGrid,
  Bot,
  Droplet,
  BarChart3,
  Settings,
  Radar,
  Menu,
  LogOut,
  X,
  Pickaxe,
} from 'lucide-react';
import { buildFleetRecommendations, type AdvisorFleetMiner } from '@/lib/advisor';
import { setPollCache } from '@/lib/use-smart-polling';

type NavItem = {
  label: string;
  href: string;
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
  badgeKey?: 'criticalAdvice' | 'recentAlerts';
  badgeTone?: 'blue' | 'rose';
};

const NAV_ITEMS: NavItem[] = [
  { label: 'Découverte', href: '/discover', icon: Radar },
  { label: 'Tableau de bord', href: '/dashboard', icon: LayoutGrid },
  { label: 'Conseiller', href: '/advisor', icon: Bot, badgeKey: 'criticalAdvice', badgeTone: 'blue' },
  { label: 'Pools', href: '/pools', icon: Droplet },
  { label: 'Records', href: '/records', icon: BarChart3 },
];

/** Titres du header par préfixe de route. */
const PAGE_TITLES: Record<string, string> = {
  dashboard: 'Tableau de bord',
  miners: 'Mineurs',
  advisor: 'Conseiller',
  pools: 'Pools',
  records: 'Records',
  alerts: 'Alertes',
  settings: 'Paramètres',
  discover: 'Découverte',
};

type AuthUser = { name: string; email: string } | null;
type Org = { id: string; name: string; slug: string };
type AlertBadgeEvent = { ts: number };
type FleetSummary = {
  totals?: { miners?: number; online?: number; offline?: number };
  miners?: AdvisorFleetMiner[];
};
type ProfitPayload = {
  totals?: { dailyNetEur?: number; monthlyNetEur?: number; dailyElecCostEur?: number; dailyGrossEur?: number };
  crypto?: { btcPriceEur?: number; btcPriceUsd?: number; difficulty?: number };
  config?: { elecCostEurKwh?: number; poolFeePct?: number };
};

const fmtEur0 = (n?: number) =>
  n === undefined || Number.isNaN(n) ? '—' : `€${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

const fmtDifficulty = (n?: number) => {
  if (!n) return '—';
  if (n >= 1e12) return `${(n / 1e12).toFixed(1)}T`;
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}G`;
  return n.toLocaleString();
};

export default function Layout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [authUser, setAuthUser] = useState<AuthUser>(null);
  const [organizations, setOrganizations] = useState<Org[]>([]);
  const [activeOrgId, setActiveOrgId] = useState('');
  const [orgName, setOrgName] = useState('NOVA');
  const [badges, setBadges] = useState<Record<string, number>>({});
  const [backendDown, setBackendDown] = useState(false);
  const [profit, setProfit] = useState<ProfitPayload | null>(null);
  const [clock, setClock] = useState('');

  // Auth / org context
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/auth/me');
        if (!res.ok) return;
        const payload = await res.json();
        setAuthUser(payload.user || null);
        setOrganizations(payload.organizations || []);
        const activeOrg = payload.organization || payload.organizations?.[0];
        setActiveOrgId(activeOrg?.id || '');
        setOrgName(activeOrg?.name || 'NOVA');
      } catch { /* unauthenticated */ }
    })();
  }, []);

  // Sidebar badges + backend reachability
  useEffect(() => {
    let cancelled = false;
    const fetchBadges = async () => {
      try {
        const [fleetRes, alertsRes] = await Promise.all([
          fetch('/api/miner/fleet').catch(() => null),
          fetch('/api/alerts/history?limit=50').catch(() => null),
        ]);
        const nextBadges: Record<string, number> = {};
        if (fleetRes?.ok) {
          const fleet = await fleetRes.json() as FleetSummary;
          // Seed the shared cache so the first visit to Dashboard / Rig
          // Management renders instantly instead of waiting for a full poll.
          setPollCache('fleet', fleet);
          try {
            const recs = buildFleetRecommendations(fleet.miners || [], fleet.totals?.miners || 0);
            nextBadges.criticalAdvice = recs.filter((r) => r.severity === 'critical').length;
          } catch { /* ignore */ }
        }
        if (alertsRes?.ok) {
          const alerts = await alertsRes.json();
          const oneHourAgo = Date.now() - 3600_000;
          const recent = ((alerts.events || []) as AlertBadgeEvent[]).filter((event) => event.ts > oneHourAgo);
          nextBadges.recentAlerts = recent.length;
        }
        if (!cancelled) {
          setBadges(nextBadges);
          // Both fetches rejecting at network level means the backend is gone
          // (the PWA service worker keeps serving the cached shell regardless).
          setBackendDown(!fleetRes && !alertsRes);
        }
      } catch { /* ignore */ }
    };

    fetchBadges();
    const interval = setInterval(fetchBadges, 60_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  // Economics strip data
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

  // Live UTC clock (client-only — starts empty so SSR markup matches)
  useEffect(() => {
    const tick = () => setClock(`${new Date().toISOString().slice(11, 19)} UTC`);
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, []);

  // Close the mobile drawer on navigation
  useEffect(() => {
    setMobileNavOpen(false);
  }, [router.asPath]);

  useEffect(() => {
    if (!mobileNavOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previousOverflow; };
  }, [mobileNavOpen]);

  const logout = async () => {
    try { await fetch('/api/auth/logout', { method: 'POST' }); }
    finally {
      setAuthUser(null);
      router.push('/');
    }
  };

  const switchOrg = async (orgId: string) => {
    try {
      const res = await fetch('/api/org/switch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orgId }),
      });
      if (!res.ok) return;
      const payload = await res.json();
      setActiveOrgId(payload.organization?.id || orgId);
      setOrgName(payload.organization?.name || orgName);
      router.reload();
    } catch { /* ignore */ }
  };

  const isItemActive = (href: string) =>
    router.pathname === href || router.pathname.startsWith(href + '/');

  const firstSegment = router.asPath.split('?')[0].split('/').filter(Boolean)[0] || 'dashboard';
  const pageTitle = PAGE_TITLES[firstSegment] || firstSegment.charAt(0).toUpperCase() + firstSegment.slice(1);

  const crypto = profit?.crypto;
  const profitConfig = profit?.config;
  const totals = profit?.totals;

  return (
    <div className="font-sans antialiased flex min-h-[100dvh] relative overflow-x-hidden bg-[#030304] text-slate-300">

      {/* Ambient Background Orbs */}
      <div className="fixed inset-0 pointer-events-none z-[-1] overflow-hidden">
        <div className="absolute top-[-10%] right-[-5%] w-[800px] h-[800px] rounded-full bg-btc-500/5 blur-[150px]" />
        <div className="absolute bottom-[-20%] left-[-10%] w-[600px] h-[600px] rounded-full bg-blue-500/[0.03] blur-[120px]" />
      </div>

      {/* Mobile overlay */}
      {mobileNavOpen && (
        <button
          type="button"
          aria-label="Fermer la navigation"
          className="fixed inset-0 z-30 bg-obsidian-950/60 backdrop-blur-sm lg:hidden"
          onClick={() => setMobileNavOpen(false)}
        />
      )}

      {/* Persistent Left Sidebar */}
      <aside className={`w-64 fixed flex flex-col left-0 top-0 bottom-0 bg-obsidian-900 border-r border-white/5 z-40 transition-transform ${mobileNavOpen ? 'translate-x-0' : '-translate-x-full'} lg:translate-x-0`}>
        <div className="h-[72px] flex items-center px-6 border-b border-white/5 shrink-0">
          {/* Logo animé : pioche de mineur, glow pulsant + reflet balayant */}
          <div className="logo-mark w-9 h-9 rounded-lg relative overflow-hidden bg-obsidian-950 border border-btc-500/30 flex items-center justify-center shadow-[inset_0_1px_1px_rgba(255,255,255,0.1)] shrink-0">
            <div className="logo-sheen" />
            <Pickaxe className="logo-cube w-[20px] h-[20px] text-btc-500" strokeWidth={2.2} aria-label="FindMyMiners" />
          </div>
          <div className="ml-3 min-w-0 flex-1">
            <div className="font-bold text-[15px] leading-tight tracking-tight truncate">
              <span className="text-slate-100">FindMy</span><span className="text-btc-500 glow-btc">Miners</span>
            </div>
          </div>
          <button
            type="button"
            className="lg:hidden p-1.5 text-slate-500 hover:text-white rounded"
            onClick={() => setMobileNavOpen(false)}
            aria-label="Fermer le menu"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <nav className="flex-1 px-4 py-6 space-y-1 overflow-y-auto">
          {NAV_ITEMS.map((item) => {
            const active = isItemActive(item.href);
            const badgeCount = item.badgeKey ? (badges[item.badgeKey] || 0) : 0;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`focus-ring flex items-center gap-3 px-3 py-2.5 rounded-lg relative group transition-colors ${
                  active
                    ? 'bg-white/[0.04] text-slate-100 border border-white/[0.02]'
                    : 'text-slate-400 hover:text-slate-100 hover:bg-white/[0.02]'
                }`}
              >
                {active && <div className="absolute inset-y-1.5 left-0 w-[3px] rounded-r-full bg-btc-500" />}
                <item.icon className={`w-[18px] h-[18px] transition-transform group-hover:scale-110 ${active ? 'text-btc-500' : ''}`} />
                <span className="text-sm font-medium">{item.label}</span>
                {badgeCount > 0 && (
                  <span className={`ml-auto flex h-5 min-w-5 px-1 items-center justify-center rounded-full text-[10px] font-bold ${
                    item.badgeTone === 'rose'
                      ? 'bg-rose-500/10 text-rose-500'
                      : 'bg-blue-500/10 text-blue-400'
                  }`}>
                    {badgeCount}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>

        <div className="px-4 py-6 border-t border-white/5 space-y-1">
          {organizations.length > 1 && (
            <select
              value={activeOrgId}
              onChange={(event) => void switchOrg(event.target.value)}
              className="focus-ring w-full mb-2 bg-obsidian-950 border border-white/10 rounded-md py-1.5 px-2 text-xs text-slate-300"
            >
              {organizations.map((org) => (
                <option key={org.id} value={org.id} style={{ background: '#0a0a0c' }}>
                  {org.name}
                </option>
              ))}
            </select>
          )}
          <Link href="/settings" className="focus-ring flex items-center gap-3 px-3 py-2 rounded-lg text-slate-500 hover:text-slate-300 transition-colors">
            <Settings className="w-[18px] h-[18px]" />
            <span className="text-sm">Paramètres</span>
          </Link>
          {authUser && (
            <button
              type="button"
              onClick={logout}
              className="focus-ring w-full flex items-center gap-3 px-3 py-2 rounded-lg text-slate-500 hover:text-slate-300 transition-colors"
            >
              <LogOut className="w-[18px] h-[18px]" />
              <span className="text-sm">Déconnexion</span>
            </button>
          )}
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 lg:ml-64 flex flex-col min-w-0 w-full transition-all">

        {/* Header & Economics Strip */}
        <header className="flex flex-col sticky top-0 z-30 bg-obsidian-950/80 backdrop-blur-xl border-b border-white/5">
          {/* Top Bar */}
          <div className="h-[72px] flex items-center justify-between px-6 lg:px-8">
            <div className="flex items-center gap-4">
              <button
                type="button"
                className="focus-ring lg:hidden p-2 text-slate-400 hover:text-white rounded-lg"
                aria-label="Ouvrir le menu"
                onClick={() => setMobileNavOpen(true)}
              >
                <Menu className="w-5 h-5" />
              </button>
              <div>
                <h1 className="text-xl md:text-2xl text-slate-100 font-semibold tracking-tight">
                  {pageTitle}
                  <span className="text-sm font-normal text-slate-500 ml-3 hidden sm:inline-block">Console {orgName}</span>
                </h1>
              </div>
            </div>
            <div className="flex items-center gap-5">
              {backendDown ? (
                <div className="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-md bg-rose-500/10 border border-rose-500/20">
                  <div className="w-2 h-2 rounded-full bg-rose-500 dot-glow-rose" />
                  <span className="text-[11px] font-mono font-medium text-rose-400 tracking-wide">SERVEUR HORS LIGNE</span>
                </div>
              ) : (
                <div className="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-md bg-emerald-500/10 border border-emerald-500/20">
                  <div className="w-2 h-2 rounded-full bg-emerald-500 dot-glow-emerald animate-pulse" />
                  <span className="text-[11px] font-mono font-medium text-emerald-400 tracking-wide">MAINNET SYNCHRONISÉ</span>
                </div>
              )}
              <span className="font-mono text-sm text-slate-400">{clock || '··:··:·· UTC'}</span>
            </div>
          </div>

          {/* Slim Economics Row */}
          <div className="py-2.5 px-6 lg:px-8 border-t border-white/5 bg-white/[0.01] overflow-x-auto">
            <div className="flex items-center space-x-8 text-[13px] whitespace-nowrap min-w-max">
              <div className="flex items-baseline gap-2">
                <span className="text-slate-500 uppercase text-[10px] tracking-wider font-semibold">Prix BTC</span>
                <span className="font-mono text-slate-200">
                  {fmtEur0(crypto?.btcPriceEur)}{' '}
                  {crypto?.btcPriceUsd !== undefined && (
                    <span className="text-slate-500">${crypto.btcPriceUsd.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
                  )}
                </span>
              </div>
              <div className="w-px h-4 bg-white/10" />
              <div className="flex items-baseline gap-2">
                <span className="text-slate-500 uppercase text-[10px] tracking-wider font-semibold">Difficulté</span>
                <span className="font-mono text-slate-200">{fmtDifficulty(crypto?.difficulty)}</span>
              </div>
              <div className="w-px h-4 bg-white/10" />
              <div className="flex items-baseline gap-2">
                <span className="text-slate-500 uppercase text-[10px] tracking-wider font-semibold">Est. flotte/jour</span>
                <span className="font-mono text-emerald-400">{fmtEur0(totals?.dailyNetEur)}</span>
              </div>
              <div className="w-px h-4 bg-white/10" />
              <div className="flex items-baseline gap-2">
                <span className="text-slate-500 uppercase text-[10px] tracking-wider font-semibold">Est. flotte/mois</span>
                <span className="font-mono text-emerald-400">{fmtEur0(totals?.monthlyNetEur)}</span>
              </div>
              <div className="w-px h-4 bg-white/10" />
              <div className="flex items-baseline gap-2">
                <span className="text-slate-500 uppercase text-[10px] tracking-wider font-semibold">Élec moy.</span>
                <span className="font-mono text-slate-200">
                  {profitConfig?.elecCostEurKwh !== undefined ? `€${profitConfig.elecCostEurKwh.toFixed(3)}/kWh` : '—'}
                </span>
              </div>
              <div className="w-px h-4 bg-white/10" />
              <div className="flex items-baseline gap-2">
                <span className="text-slate-500 uppercase text-[10px] tracking-wider font-semibold">Frais pool moy.</span>
                <span className="font-mono text-slate-200">
                  {profitConfig?.poolFeePct !== undefined ? `${profitConfig.poolFeePct}%` : '—'}
                </span>
              </div>
            </div>
          </div>
        </header>

        <div className="flex-1 p-6 lg:p-8 space-y-6">
          {children}
        </div>
      </main>
    </div>
  );
}
