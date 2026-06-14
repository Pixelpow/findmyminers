import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import { MoreHorizontal, ChevronDown, ChevronUp, RefreshCw } from 'lucide-react';
import { appCardStyle as baseCardStyle } from '@/lib/styles';
import { fmtHash } from '@/lib/format';

type MaintenanceInsight = {
  id: string;
  severity: 'info' | 'warning' | 'critical';
  title: string;
  message: string;
};

type DiffAccountRecord = {
  accountKey: string;
  poolUrl: string | null;
  source: string | null;
  bestDiff: number;
  bestDiffAt: number | null;
  lastDiff: number;
  lastDiffAt: number | null;
  diffAccepted: number;
  diffRejected: number;
  updatedAt: number;
};

type DiffRecord = {
  bestDiff: number;
  bestDiffAt: number | null;
  bestDiffAccountKey?: string | null;
  bestDiffPoolUrl?: string | null;
  bestDiffMinerId?: string | null;
  bestDiffMinerName?: string | null;
  lastDiff: number;
  lastDiffAt: number | null;
  lastDiffAccountKey?: string | null;
  lastDiffPoolUrl?: string | null;
  lastDiffMinerId?: string | null;
  lastDiffMinerName?: string | null;
  updatedAt: number;
};

type DiffSummary = {
  minerRecord: DiffRecord | null;
  accountRecords: DiffAccountRecord[];
  globalRecord: DiffRecord | null;
};

type StatusData = {
  miner: any;
  model?: string;
  firmware?: string;
  description?: string;
  offline?: boolean;
  source?: string;
  summary: any;
  devs: any[];
  pools: any[];
  hardware: any;
  rawStats: any;
  maintenanceInsights?: MaintenanceInsight[];
  diffRecords?: DiffSummary;
};

function appCardStyle(radius = 24, padding = '20px 22px'): React.CSSProperties {
  return { ...baseCardStyle(radius, padding), marginBottom: 14 };
}

const cardStyle: React.CSSProperties = appCardStyle(26, '20px 22px');
const labelStyle: React.CSSProperties = { fontSize: 12.5, color: 'var(--muted)', marginBottom: 4 };
const valueStyle: React.CSSProperties = { fontSize: 14.5, color: 'var(--foreground)', fontWeight: 500 };

type HistoryPoint = {
  ts: number;
  hashrateTHs: number;
  tempAvg: number;
  tempMax: number;
  powerW: number;
  poolAlive: boolean;
  accepted: number;
  rejected: number;
  stale: number;
  hardwareErrors: number;
};

type HistoryData = {
  points: HistoryPoint[];
  stats: {
    avgHashrate: number;
    avgTemp: number;
    avgPower: number;
    uptimeRatio: number;
    rejectedTotal: number;
    acceptedTotal: number;
    staleTotal: number;
  };
};

type MinerEvent = {
  ts: number;
  type: string;
  category: 'system' | 'action' | 'alert' | 'maintenance';
  severity: 'info' | 'success' | 'warning' | 'critical';
  minerId: string;
  minerName: string;
  message: string;
};

const RANGES = ['1h', '6h', '24h', '7d', '30d'] as const;

function Sparkline({
  data, width = 320, height = 80, color = '#f7931a', fillOpacity = 0.1, label, unit, currentValue,
}: {
  data: number[]; width?: number; height?: number; color?: string; fillOpacity?: number;
  label: string; unit: string; currentValue?: string;
}) {
  if (!data.length) return null;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const pad = 2;
  const w = width;
  const h = height;
  const points = data.map((v, i) => {
    const x = (i / Math.max(1, data.length - 1)) * (w - pad * 2) + pad;
    const y = h - pad - ((v - min) / range) * (h - pad * 2);
    return `${x},${y}`;
  });
  const line = points.join(' ');
  const fill = `${points.join(' ')} ${w - pad},${h - pad} ${pad},${h - pad}`;

  return (
    <div style={{ flex: 1, minWidth: 200 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
        <span style={{ fontSize: 12, color: '#71717a' }}>{label}</span>
        {currentValue && <span style={{ fontSize: 14, fontWeight: 600, color }}>{currentValue} {unit}</span>}
      </div>
      <svg width="100%" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{ display: 'block' }}>
        <polygon points={fill} fill={color} fillOpacity={fillOpacity} />
        <polyline points={line} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" />
      </svg>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10.5, color: '#52525b', marginTop: 2 }}>
        <span>Min: {min.toFixed(1)} {unit}</span>
        <span>Max: {max.toFixed(1)} {unit}</span>
      </div>
    </div>
  );
}

function HealthGauge({ score }: { score: number }) {
  const color = score >= 80 ? '#4ade80' : score >= 60 ? '#fb923c' : score >= 40 ? '#f59e0b' : '#f87171';
  const label = score >= 80 ? 'Excellent' : score >= 60 ? 'Bon' : score >= 40 ? 'Moyen' : 'Faible';
  const circumference = 2 * Math.PI * 40;
  const offset = circumference - (score / 100) * circumference;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
      <svg width="100" height="100" viewBox="0 0 100 100">
        <circle cx="50" cy="50" r="40" fill="none" stroke="#27272a" strokeWidth="6" />
        <circle cx="50" cy="50" r="40" fill="none" stroke={color} strokeWidth="6"
          strokeDasharray={circumference} strokeDashoffset={offset}
          strokeLinecap="round" transform="rotate(-90 50 50)"
          style={{ transition: 'stroke-dashoffset 0.8s ease' }} />
        <text x="50" y="46" textAnchor="middle" fill={color} fontSize="22" fontWeight="700">{score}</text>
        <text x="50" y="62" textAnchor="middle" fill="#71717a" fontSize="9">{label}</text>
      </svg>
    </div>
  );
}

function fmt(n: number | undefined, digits = 2) {
  if (n == null || isNaN(n)) return '—';
  return n.toFixed(digits);
}

function fmtUptime(elapsed: number) {
  if (!elapsed) return '—';
  const h = Math.floor(elapsed / 3600);
  const m = Math.floor((elapsed % 3600) / 60);
  return `${h}h ${m}m`;
}

function fmtDiff(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value) || value <= 0) return '—';

  const suffixes = ['', 'K', 'M', 'G', 'T', 'P', 'E'];
  let scaled = value;
  let suffixIndex = 0;

  while (scaled >= 1000 && suffixIndex < suffixes.length - 1) {
    scaled /= 1000;
    suffixIndex += 1;
  }

  if (suffixIndex === 0) {
    return scaled.toLocaleString(undefined, { maximumFractionDigits: 0 });
  }

  const decimals = scaled >= 100 ? 0 : scaled >= 10 ? 1 : 2;
  return `${scaled.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: decimals,
  })}${suffixes[suffixIndex]}`;
}

function fmtWhen(ts: number | null | undefined) {
  if (!ts) return '—';
  return new Date(ts).toLocaleString();
}

export default function MinerDetailPage() {
  const router = useRouter();
  const { id } = router.query;
  const [data, setData] = useState<StatusData | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'status' | 'charts' | 'timeline' | 'settings'>('status');
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [settingsForm, setSettingsForm] = useState({ name: '', port: '4028' });
  const [miners, setMiners] = useState<any[]>([]);
  const [history, setHistory] = useState<HistoryData | null>(null);
  const [historyRange, setHistoryRange] = useState<string>('24h');
  const [historyLoading, setHistoryLoading] = useState(false);
  const [events, setEvents] = useState<MinerEvent[]>([]);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [fanMode, setFanMode] = useState<'low' | 'medium' | 'high' | null>(null);
  const [fanLoading, setFanLoading] = useState(false);
  const [fanFeedback, setFanFeedback] = useState<string | null>(null);
  const [perfMode, setPerfMode] = useState<'low' | 'normal' | 'high' | null>(null);
  const [perfLoading, setPerfLoading] = useState(false);
  const [perfFeedback, setPerfFeedback] = useState<string | null>(null);
  const [autoMode, setAutoMode] = useState(false);
  const [autoLoading, setAutoLoading] = useState(false);
  const [autoFeedback, setAutoFeedback] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    const fetchStatus = async () => {
      try {
        const res = await fetch(`/api/miner/status?minerId=${encodeURIComponent(id as string)}`);
        if (!res.ok) return;
        const json = await res.json();
        setData(json);
        setLoading(false);
      } catch { setLoading(false); }
    };
    const loadConfig = async () => {
      const res = await fetch('/api/miner/config');
      if (!res.ok) return;
      const json = await res.json();
      setMiners(json.miners || []);
      const m = (json.miners || []).find((mn: any) => mn.id === id);
      if (m) setSettingsForm({ name: m.name, port: String(m.port || 4028) });
    };
    fetchStatus();
    loadConfig();
    const t = setInterval(fetchStatus, 6000);
    return () => clearInterval(t);
  }, [id]);

  // Fetch telemetry history for charts
  useEffect(() => {
    if (!id) return;
    setHistoryLoading(true);
    (async () => {
      try {
        const res = await fetch(`/api/miner/history?minerId=${encodeURIComponent(id as string)}&range=${historyRange}`);
        if (!res.ok) return;
        const json = await res.json();
        setHistory(json);
      } catch { /* ignore */ }
      finally { setHistoryLoading(false); }
    })();
  }, [id, historyRange]);

  useEffect(() => {
    if (!id || tab !== 'timeline') return;

    let active = true;
    const loadEvents = async () => {
      setEventsLoading(true);
      try {
        const res = await fetch(`/api/miner/events?minerId=${encodeURIComponent(id as string)}&limit=100`);
        if (!res.ok) return;
        const json = await res.json();
        if (active) {
          setEvents(json.events || []);
        }
      } catch {
        /* ignore */
      } finally {
        if (active) {
          setEventsLoading(false);
        }
      }
    };

    loadEvents();
    const t = setInterval(loadEvents, 15000);
    return () => {
      active = false;
      clearInterval(t);
    };
  }, [id, tab]);

  const healthScore = useMemo(() => {
    if (!history?.points?.length) return 0;
    const pts = history.points;
    const aliveCount = pts.filter((p) => p.poolAlive).length;
    const uptimeRatio = aliveCount / pts.length;
    const uptimeScore = uptimeRatio * 30;
    const hashrates = pts.map((p) => p.hashrateTHs).filter((h) => h > 0);
    let stabilityScore = 25;
    if (hashrates.length >= 2) {
      const mean = hashrates.reduce((a, b) => a + b, 0) / hashrates.length;
      if (mean > 0) {
        const variance = hashrates.reduce((sum, h) => sum + (h - mean) ** 2, 0) / hashrates.length;
        const cv = Math.sqrt(variance) / mean;
        stabilityScore = Math.max(0, 25 * (1 - cv / 0.5));
      }
    } else if (hashrates.length === 0) stabilityScore = 0;
    const temps = pts.map((p) => p.tempAvg).filter((t) => t > 0);
    let tempScore = 20;
    if (temps.length > 0) {
      const maxT = Math.max(...temps);
      const avgT = temps.reduce((a, b) => a + b, 0) / temps.length;
      if (maxT >= 95) tempScore = 0;
      else if (avgT >= 90) tempScore = 4;
      else if (avgT >= 85) tempScore = 10;
      else if (avgT >= 80) tempScore = 15;
    }
    const totalA = pts.reduce((s, p) => s + p.accepted, 0);
    const totalR = pts.reduce((s, p) => s + p.rejected, 0);
    const totalS = pts.reduce((s, p) => s + p.stale, 0);
    const totalShares = totalA + totalR + totalS;
    let rejectScore = 15;
    if (totalShares > 0) rejectScore = Math.max(0, 15 * (1 - (totalR + totalS) / totalShares / 0.05));
    const totalHw = pts.reduce((s, p) => s + p.hardwareErrors, 0);
    let hwScore = 10;
    if (totalHw > 100) hwScore = 0;
    else if (totalHw > 50) hwScore = 3;
    else if (totalHw > 10) hwScore = 6;
    else if (totalHw > 0) hwScore = 8;
    return Math.round(Math.min(100, Math.max(0, uptimeScore + stabilityScore + tempScore + rejectScore + hwScore)));
  }, [history]);

  const miner = data?.miner || miners.find((m) => m.id === id);
  const summary = data?.summary;
  const hardware = data?.hardware;
  const pools = data?.pools || [];
  const activePool = pools.find((p: any) => p['Stratum Active']) || pools[0];
  const elapsed = summary?.Elapsed || 0;
  const hrParts = summary?.['MHS 1m'] ? fmtHash(summary['MHS 1m'] / 1_000_000).split(' ') : null;
  const accepted = summary?.Accepted ?? 0;
  const rejected = summary?.Rejected ?? 0;
  const stale = summary?.Stale ?? 0;
  const total = accepted + rejected + stale;
  const rejPct = total ? ((rejected / total) * 100).toFixed(1) : '0.0';
  const tempAvg = hardware?.TAvg ?? 0;
  const powerW = hardware?.MPO ? parseFloat(hardware.MPO) : hardware?.WORKMODE === '0' ? 65 : hardware?.WORKMODE === '2' ? 140 : 90;
  const fanRpm = hardware?.FanR ?? 0;
  const fanPct = fanRpm > 0 ? Math.round(Math.min(100, (fanRpm / 6000) * 100)) : (hardware?.FanP ?? hardware?.FanPct ?? 0);
  const isOnline = !data?.offline;
  const currentWorkmode = hardware?.WORKMODE;
  const detectedPerfMode = currentWorkmode === '0' ? 'low' : currentWorkmode === '2' ? 'high' : currentWorkmode === '1' ? 'normal' : null;
  const chipTemps = (() => {
    if (!data?.devs?.length) return [];
    const temps: number[] = [];
    for (const dev of data.devs) {
      for (const key of Object.keys(dev || {})) {
        if (/^Temp\d+|^Chip Temp/i.test(key)) {
          const v = Number(dev[key]);
          if (!isNaN(v) && v > 0) temps.push(v);
        }
      }
    }
    return temps;
  })();

  const restart = async () => {
    setActionLoading(true);
    try {
      await fetch('/api/miner/control', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reboot', minerId: id }),
      });
    } catch { /* ignore */ }
    finally { setActionLoading(false); }
  };

  const FAN_PRESETS = { low: 30, medium: 60, high: 100 } as const;
  const FAN_LABELS = { low: 'Basse', medium: 'Moyenne', high: 'Haute' } as const;

  const setFanPreset = async (preset: 'low' | 'medium' | 'high') => {
    setFanLoading(true);
    setFanFeedback(null);
    try {
      const res = await fetch('/api/miner/control', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'fan', value: String(FAN_PRESETS[preset]), minerId: id }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Erreur');
      }
      setFanMode(preset);
      setAutoMode(false);
      setFanFeedback(`Ventilation → ${FAN_LABELS[preset]} (${FAN_PRESETS[preset]}%)`);
    } catch (e: any) {
      setFanFeedback(`Erreur: ${e.message}`);
    } finally {
      setFanLoading(false);
      setTimeout(() => setFanFeedback(null), 4000);
    }
  };

  const PERF_PRESETS = {
    low: { value: '0', watt: 65, label: 'Éco', emoji: '🍃', desc: 'Silencieux · 65 W' },
    normal: { value: '1', watt: 90, label: 'Normal', emoji: '⚡', desc: 'Standard · 90 W' },
    high: { value: '2', watt: 140, label: 'Perf', emoji: '🔥', desc: 'Performance · 140 W' },
  } as const;

  const setPerformanceProfile = async (preset: 'low' | 'normal' | 'high') => {
    setPerfLoading(true);
    setPerfFeedback(null);
    try {
      const res = await fetch('/api/miner/control', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'mode', value: PERF_PRESETS[preset].value, minerId: id }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Erreur');
      }
      setPerfMode(preset);
      setPerfFeedback(`Mode → ${PERF_PRESETS[preset].label} (${PERF_PRESETS[preset].watt}W)`);
    } catch (e: any) {
      setPerfFeedback(`Erreur: ${e.message}`);
    } finally {
      setPerfLoading(false);
      setTimeout(() => setPerfFeedback(null), 4000);
    }
  };

  const toggleAutoMode = async () => {
    setAutoLoading(true);
    setAutoFeedback(null);
    const enabling = !autoMode;
    try {
      // Enable/disable smart-speed (auto fan management)
      const res1 = await fetch('/api/miner/control', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'smart-speed', value: enabling ? '1' : '0', minerId: id }),
      });
      if (!res1.ok) {
        const err = await res1.json().catch(() => ({}));
        throw new Error(err.error || 'Erreur smart-speed');
      }
      // Set target temp when enabling auto mode
      if (enabling) {
        const res2 = await fetch('/api/miner/control', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'target-temp', value: '75', minerId: id }),
        });
        if (!res2.ok) {
          const err = await res2.json().catch(() => ({}));
          throw new Error(err.error || 'Erreur target-temp');
        }
      }
      setAutoMode(enabling);
      if (enabling) setFanMode(null);
      setAutoFeedback(enabling ? 'Auto activé · Target 75°C · Fan auto' : 'Auto désactivé · Fan manuel');
    } catch (e: any) {
      setAutoFeedback(`Erreur: ${e.message}`);
    } finally {
      setAutoLoading(false);
      setTimeout(() => setAutoFeedback(null), 4000);
    }
  };

  const saveSettings = async () => {
    try {
      const res = await fetch('/api/miner/config');
      if (!res.ok) return;
      const json = await res.json();
      const updated = (json.miners || []).map((m: any) =>
        m.id === id ? { ...m, name: settingsForm.name, port: parseInt(settingsForm.port) || 4028 } : m
      );
      await fetch('/api/miner/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ miners: updated }),
      });
      setMiners(updated);
    } catch { /* ignore */ }
  };

  const tabBtn = (t: 'status' | 'charts' | 'timeline' | 'settings', label: string) => (
    <button onClick={() => setTab(t)}
      style={{
        height: 40,
        padding: '0 16px',
        background: tab === t ? 'rgba(247,147,26,0.12)' : 'rgba(255,255,255,0.03)',
        border: tab === t ? '1px solid rgba(247,147,26,0.18)' : '1px solid var(--border-1)',
        cursor: 'pointer',
        fontSize: 13,
        fontWeight: tab === t ? 700 : 600,
        color: tab === t ? 'var(--accent-strong)' : 'var(--muted)',
        borderRadius: 999,
        transition: 'all 0.12s ease',
      }}
    >
      {label}
    </button>
  );

  if (loading && !data) {
    return <div style={{ padding: 40, color: 'var(--muted)', fontSize: 14 }}>Chargement…</div>;
  }

  const eventColor = (severity: MinerEvent['severity']) => {
    if (severity === 'critical') return { bg: 'rgba(239,68,68,0.12)', border: 'rgba(239,68,68,0.25)', color: '#f87171' };
    if (severity === 'warning') return { bg: 'rgba(251,146,60,0.12)', border: 'rgba(251,146,60,0.25)', color: '#fb923c' };
    if (severity === 'success') return { bg: 'rgba(34,197,94,0.12)', border: 'rgba(34,197,94,0.25)', color: '#4ade80' };
    return { bg: 'rgba(96,165,250,0.12)', border: 'rgba(96,165,250,0.25)', color: '#60a5fa' };
  };

  const eventLabel = (event: MinerEvent) => {
    if (event.category === 'alert') return 'Alerte';
    if (event.category === 'maintenance') return 'Maintenance';
    if (event.category === 'action') return 'Action';
    return 'Système';
  };

  const formatEventTime = (ts: number) => {
    const diffMs = Date.now() - ts;
    if (diffMs < 60_000) return 'à l’instant';
    if (diffMs < 3_600_000) return `il y a ${Math.floor(diffMs / 60_000)} min`;
    if (diffMs < 86_400_000) return `il y a ${Math.floor(diffMs / 3_600_000)} h`;
    return new Date(ts).toLocaleString();
  };

  const insightColor = (severity: MaintenanceInsight['severity']) => {
    if (severity === 'critical') return { bg: 'rgba(239,68,68,0.12)', border: 'rgba(239,68,68,0.25)', color: '#f87171' };
    if (severity === 'warning') return { bg: 'rgba(251,146,60,0.12)', border: 'rgba(251,146,60,0.25)', color: '#fb923c' };
    return { bg: 'rgba(96,165,250,0.12)', border: 'rgba(96,165,250,0.25)', color: '#60a5fa' };
  };

  return (
    <>
      <Head><title>{miner?.name || id} | FindMyMiners</title></Head>
      <div style={{ maxWidth: 980, minHeight: '100%' }}>
        {/* Header card */}
        <div style={{ ...cardStyle, borderRadius: 28 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 20 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <span style={{
                height: 30, padding: '0 12px', display: 'inline-flex', alignItems: 'center', borderRadius: 9999, fontSize: 12, fontWeight: 700,
                background: isOnline ? 'rgba(34,197,94,0.12)' : 'rgba(239,68,68,0.12)',
                color: isOnline ? '#4ade80' : '#f87171',
                border: `1px solid ${isOnline ? 'rgba(34,197,94,0.2)' : 'rgba(239,68,68,0.2)'}`,
              }}>
                {isOnline ? 'En ligne' : 'Hors ligne'}
              </span>
              <div>
                <div style={{ fontSize: 17, fontWeight: 700, color: 'var(--foreground)' }}>{miner?.name || String(id)}</div>
                <div style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 2 }}>
                  {data?.model || miner?.model || 'Modèle inconnu'} · SHA256
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={restart} disabled={actionLoading}
                style={{ height: 40, padding: '0 14px', background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border-1)', borderRadius: 14, color: 'var(--foreground)', fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, fontWeight: 700 }}>
                <RefreshCw style={{ width: 13, height: 13 }} />
                {actionLoading ? '…' : 'Redémarrer'}
              </button>
              <button style={{ width: 40, height: 40, padding: 0, background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border-1)', borderRadius: 14, color: 'var(--muted)', cursor: 'pointer' }}>
                <MoreHorizontal style={{ width: 16, height: 16 }} />
              </button>
            </div>
          </div>

          {/* Stats row */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 0 }}>
            <div style={{ borderRight: '1px solid var(--border-1)', paddingRight: 24 }}>
              <div style={labelStyle}>Hashrate</div>
              <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--foreground)' }}>{hrParts ? <>{hrParts[0]} <span style={{ fontSize: 14, fontWeight: 400, color: 'var(--muted)' }}>{hrParts[1]}</span></> : '—'}</div>
            </div>
            <div style={{ borderRight: '1px solid var(--border-1)', padding: '0 24px' }}>
              <div style={labelStyle}>Shares</div>
              <div style={{ fontSize: 15, color: 'var(--muted)' }}>
                {accepted.toLocaleString()} <span style={{ color: '#4ade80', fontSize: 13 }}>✓</span>{' '}
                {rejected > 0 && <><span style={{ color: '#f87171' }}>{rejected}</span> X <span style={{ color: '#f87171', fontSize: 11.5 }}>({rejPct}%)</span></>}
                {rejected === 0 && stale === 0 ? '' : stale > 0 ? <span style={{ color: '#fb923c' }}> {stale} !</span> : ''}
              </div>
            </div>
            <div style={{ paddingLeft: 24 }}>
              <div style={labelStyle}>Uptime</div>
              <div style={{ fontSize: 17, fontWeight: 700, color: 'var(--foreground)' }}>{fmtUptime(elapsed)}</div>
            </div>
          </div>

          <div style={{ borderTop: '1px solid var(--border-1)', marginTop: 18, paddingTop: 18 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 0 }}>
              <div style={{ borderRight: '1px solid var(--border-1)', paddingRight: 24 }}>
                <div style={labelStyle}>Adresse MAC</div>
                <div style={valueStyle}>{hardware?.MAC || '—'}</div>
              </div>
              <div style={{ borderRight: '1px solid var(--border-1)', padding: '0 24px' }}>
                <div style={labelStyle}>Modèle</div>
                <div style={valueStyle}>{data?.model || miner?.model || miner?.name || '—'}</div>
              </div>
              <div style={{ paddingLeft: 24 }}>
                <div style={labelStyle}>Adresse IP</div>
                <div style={valueStyle}>{miner?.ip || '—'}</div>
              </div>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', marginBottom: 16, gap: 8, flexWrap: 'wrap' }}>
          {tabBtn('status', 'Statut')}
          {tabBtn('charts', 'Graphiques')}
          {tabBtn('timeline', 'Historique')}
          {tabBtn('settings', 'Réglages')}
        </div>

        {tab === 'status' && (
          <div style={cardStyle}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 0, paddingBottom: 18 }}>
              <div style={{ borderRight: '1px solid #27272a', paddingRight: 24 }}>
                <div style={labelStyle}>Température</div>
                <div style={{ fontSize: 22, fontWeight: 700, color: tempAvg > 90 ? '#f87171' : tempAvg > 80 ? '#fb923c' : '#fafafa' }}>
                  {tempAvg > 0 ? `${tempAvg.toFixed(0)}°C` : '—'}
                </div>
              </div>
              <div style={{ borderRight: '1px solid #27272a', padding: '0 24px' }}>
                <div style={labelStyle}>Consommation</div>
                <div style={{ fontSize: 22, fontWeight: 700, color: '#fafafa' }}>
                  {powerW > 0 ? `${powerW.toFixed(0)} ` : '—'}<span style={{ fontSize: 14, fontWeight: 400, color: '#71717a' }}>W</span>
                </div>
                {hardware?.MPO && <div style={{ fontSize: 11.5, color: '#52525b', marginTop: 2 }}>Limite : {hardware.MPO} W</div>}
              </div>
              <div style={{ paddingLeft: 24 }}>
                <div style={labelStyle}>Ventilation</div>
                <div style={{ fontSize: 22, fontWeight: 700, color: '#fafafa' }}>
                  {fanPct > 0 ? `${fanPct}` : '—'}<span style={{ fontSize: 14, fontWeight: 400, color: '#71717a' }}>%</span>
                </div>
                {fanRpm > 0 && <div style={{ fontSize: 12, color: '#52525b', marginTop: 2 }}>{fanRpm.toLocaleString()} rpm</div>}
              </div>
            </div>

            {/* Live Fan Speed */}
            {isOnline && (fanRpm > 0 || fanPct > 0) && (
              <div style={{ borderTop: '1px solid #27272a', marginTop: 18, paddingTop: 16 }}>
                <div style={{ ...labelStyle, marginBottom: 10 }}>Ventilation (live)</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                  <div style={{ position: 'relative', width: 64, height: 64 }}>
                    <svg width="64" height="64" viewBox="0 0 64 64">
                      <circle cx="32" cy="32" r="28" fill="none" stroke="#27272a" strokeWidth="4" />
                      <circle cx="32" cy="32" r="28" fill="none" stroke={fanPct >= 80 ? '#f87171' : fanPct >= 50 ? '#fb923c' : '#4ade80'}
                        strokeWidth="4" strokeDasharray={`${2 * Math.PI * 28}`}
                        strokeDashoffset={`${2 * Math.PI * 28 * (1 - fanPct / 100)}`}
                        strokeLinecap="round" transform="rotate(-90 32 32)"
                        style={{ transition: 'stroke-dashoffset 0.6s ease' }} />
                      <text x="32" y="30" textAnchor="middle" fill="#fafafa" fontSize="14" fontWeight="700">{fanPct}</text>
                      <text x="32" y="42" textAnchor="middle" fill="#71717a" fontSize="8">%</text>
                    </svg>
                  </div>
                  <div>
                    <div style={{ fontSize: 20, fontWeight: 700, color: '#fafafa' }}>
                      {fanPct}%
                    </div>
                    {fanRpm > 0 && (
                      <div style={{ fontSize: 13, color: '#71717a', marginTop: 2 }}>
                        {fanRpm.toLocaleString()} RPM
                      </div>
                    )}
                    <div style={{ fontSize: 11, color: '#52525b', marginTop: 2 }}>
                      {autoMode ? '🤖 Auto' : fanMode ? `Manuel · ${FAN_LABELS[fanMode]}` : 'Manuel'}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Fan Control */}
            {isOnline && data?.source !== 'axeos' && (
              <div style={{ borderTop: '1px solid #27272a', marginTop: 18, paddingTop: 16 }}>
                <div style={{ ...labelStyle, marginBottom: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
                  Contrôle ventilation
                  {fanLoading && (
                    <div style={{ width: 14, height: 14, borderRadius: '50%', border: '2px solid #27272a', borderTopColor: '#f7931a', animation: 'spin 0.8s linear infinite' }} />
                  )}
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  {(['low', 'medium', 'high'] as const).map((preset) => {
                    const active = !autoMode && fanMode === preset;
                    const colors = {
                      low: { bg: 'rgba(59,130,246,0.12)', border: 'rgba(59,130,246,0.3)', text: '#60a5fa', emoji: '🌀' },
                      medium: { bg: 'rgba(251,146,60,0.12)', border: 'rgba(251,146,60,0.3)', text: '#fb923c', emoji: '💨' },
                      high: { bg: 'rgba(239,68,68,0.12)', border: 'rgba(239,68,68,0.3)', text: '#f87171', emoji: '🌪️' },
                    };
                    const c = colors[preset];
                    return (
                      <button key={preset} onClick={() => setFanPreset(preset)} disabled={fanLoading}
                        style={{
                          flex: 1, padding: '10px 0', borderRadius: 8, cursor: fanLoading ? 'not-allowed' : 'pointer',
                          fontSize: 13, fontWeight: 600, transition: 'all 0.15s',
                          background: active ? c.bg : '#09090b',
                          border: `1.5px solid ${active ? c.border : '#27272a'}`,
                          color: active ? c.text : '#71717a',
                          opacity: fanLoading ? 0.6 : 1,
                        }}>
                        <span style={{ fontSize: 16 }}>{c.emoji}</span>
                        <div style={{ marginTop: 2 }}>{FAN_LABELS[preset]}</div>
                        <div style={{ fontSize: 10.5, fontWeight: 400, marginTop: 1, color: '#52525b' }}>
                          {FAN_PRESETS[preset]}%
                        </div>
                      </button>
                    );
                  })}
                </div>
                {fanFeedback && (
                  <div style={{
                    marginTop: 8, fontSize: 12, padding: '6px 10px', borderRadius: 6,
                    background: fanFeedback.startsWith('Erreur') ? 'rgba(239,68,68,0.1)' : 'rgba(34,197,94,0.1)',
                    color: fanFeedback.startsWith('Erreur') ? '#f87171' : '#4ade80',
                    border: `1px solid ${fanFeedback.startsWith('Erreur') ? 'rgba(239,68,68,0.2)' : 'rgba(34,197,94,0.2)'}`,
                  }}>
                    {fanFeedback}
                  </div>
                )}
              </div>
            )}

            {/* Performance Profile (Hashrate) */}
            {isOnline && data?.source !== 'axeos' && (
              <div style={{ borderTop: '1px solid #27272a', marginTop: 18, paddingTop: 16 }}>
                <div style={{ ...labelStyle, marginBottom: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
                  Profil de performance
                  {perfLoading && (
                    <div style={{ width: 14, height: 14, borderRadius: '50%', border: '2px solid #27272a', borderTopColor: '#f7931a', animation: 'spin 0.8s linear infinite' }} />
                  )}
                  {detectedPerfMode && !perfMode && (
                    <span style={{ fontSize: 10.5, color: '#52525b', fontWeight: 400 }}>
                      Actuel : {detectedPerfMode === 'low' ? 'Éco' : detectedPerfMode === 'high' ? 'Perf' : 'Normal'}
                    </span>
                  )}
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  {(['low', 'normal', 'high'] as const).map((preset) => {
                    const active = perfMode === preset || (!perfMode && detectedPerfMode === preset);
                    const p = PERF_PRESETS[preset];
                    const colors = {
                      low: { bg: 'rgba(74,222,128,0.12)', border: 'rgba(74,222,128,0.3)', text: '#4ade80' },
                      normal: { bg: 'rgba(251,146,60,0.12)', border: 'rgba(251,146,60,0.3)', text: '#fb923c' },
                      high: { bg: 'rgba(239,68,68,0.12)', border: 'rgba(239,68,68,0.3)', text: '#f87171' },
                    };
                    const c = colors[preset];
                    return (
                      <button key={preset} onClick={() => setPerformanceProfile(preset)} disabled={perfLoading}
                        style={{
                          flex: 1, padding: '10px 0', borderRadius: 8, cursor: perfLoading ? 'not-allowed' : 'pointer',
                          fontSize: 13, fontWeight: 600, transition: 'all 0.15s',
                          background: active ? c.bg : '#09090b',
                          border: `1.5px solid ${active ? c.border : '#27272a'}`,
                          color: active ? c.text : '#71717a',
                          opacity: perfLoading ? 0.6 : 1,
                        }}>
                        <span style={{ fontSize: 16 }}>{p.emoji}</span>
                        <div style={{ marginTop: 2 }}>{p.label}</div>
                        <div style={{ fontSize: 10.5, fontWeight: 400, marginTop: 1, color: '#52525b' }}>
                          {p.desc}
                        </div>
                      </button>
                    );
                  })}
                </div>
                {perfFeedback && (
                  <div style={{
                    marginTop: 8, fontSize: 12, padding: '6px 10px', borderRadius: 6,
                    background: perfFeedback.startsWith('Erreur') ? 'rgba(239,68,68,0.1)' : 'rgba(34,197,94,0.1)',
                    color: perfFeedback.startsWith('Erreur') ? '#f87171' : '#4ade80',
                    border: `1px solid ${perfFeedback.startsWith('Erreur') ? 'rgba(239,68,68,0.2)' : 'rgba(34,197,94,0.2)'}`,
                  }}>
                    {perfFeedback}
                  </div>
                )}
              </div>
            )}

            {/* Auto Mode */}
            {isOnline && data?.source !== 'axeos' && (
              <div style={{ borderTop: '1px solid #27272a', marginTop: 18, paddingTop: 16 }}>
                <div style={{ ...labelStyle, marginBottom: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
                  Mode auto
                  {autoLoading && (
                    <div style={{ width: 14, height: 14, borderRadius: '50%', border: '2px solid #27272a', borderTopColor: '#f7931a', animation: 'spin 0.8s linear infinite' }} />
                  )}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <button onClick={toggleAutoMode} disabled={autoLoading}
                    style={{
                      flex: 1, padding: '12px 16px', borderRadius: 8, cursor: autoLoading ? 'not-allowed' : 'pointer',
                      fontSize: 13, fontWeight: 600, transition: 'all 0.15s',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
                      background: autoMode ? 'rgba(168,85,247,0.12)' : '#09090b',
                      border: `1.5px solid ${autoMode ? 'rgba(168,85,247,0.3)' : '#27272a'}`,
                      color: autoMode ? '#c084fc' : '#71717a',
                      opacity: autoLoading ? 0.6 : 1,
                    }}>
                    <span style={{ fontSize: 18 }}>🤖</span>
                    <div style={{ textAlign: 'left' }}>
                      <div>{autoMode ? 'Auto activé' : 'Activer Auto'}</div>
                      <div style={{ fontSize: 10.5, fontWeight: 400, color: '#52525b', marginTop: 1 }}>
                        Ventilation auto + cible 75°C
                      </div>
                    </div>
                    <div style={{
                      marginLeft: 'auto', width: 36, height: 20, borderRadius: 10,
                      background: autoMode ? '#a855f7' : '#27272a',
                      position: 'relative', transition: 'background 0.2s',
                    }}>
                      <div style={{
                        width: 16, height: 16, borderRadius: '50%', background: '#fafafa',
                        position: 'absolute', top: 2, transition: 'left 0.2s',
                        left: autoMode ? 18 : 2,
                      }} />
                    </div>
                  </button>
                </div>
                {autoFeedback && (
                  <div style={{
                    marginTop: 8, fontSize: 12, padding: '6px 10px', borderRadius: 6,
                    background: autoFeedback.startsWith('Erreur') ? 'rgba(239,68,68,0.1)' : 'rgba(168,85,247,0.1)',
                    color: autoFeedback.startsWith('Erreur') ? '#f87171' : '#c084fc',
                    border: `1px solid ${autoFeedback.startsWith('Erreur') ? 'rgba(239,68,68,0.2)' : 'rgba(168,85,247,0.2)'}`,
                  }}>
                    {autoFeedback}
                  </div>
                )}
              </div>
            )}

            {/* ASIC chip temps */}
            {chipTemps.length > 0 && (
              <>
                <div style={{ borderTop: '1px solid #27272a', paddingTop: 16 }}>
                  <div style={{ ...labelStyle, marginBottom: 10 }}>Températures des puces ({chipTemps.length} puces)</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
                    {chipTemps.map((t, i) => (
                      <span key={i} style={{
                        fontSize: 12.5, fontWeight: 500,
                        color: t > 94 ? '#f87171' : t > 88 ? '#fb923c' : '#71717a',
                      }}>
                        {t}°
                      </span>
                    ))}
                  </div>
                </div>
              </>
            )}

            <div style={{ borderTop: '1px solid #27272a', marginTop: 18, paddingTop: 16 }}>
              <div style={{ ...labelStyle, marginBottom: 10 }}>Diagnostic maintenance</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {(data?.maintenanceInsights || []).map((insight) => {
                  const colors = insightColor(insight.severity);
                  return (
                    <div key={insight.id} style={{
                      padding: '12px 14px',
                      borderRadius: 10,
                      background: colors.bg,
                      border: `1px solid ${colors.border}`,
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5 }}>
                        <span style={{ fontSize: 12.5, fontWeight: 600, color: colors.color }}>{insight.title}</span>
                        <span style={{ fontSize: 10.5, color: '#52525b', textTransform: 'uppercase' }}>{insight.severity}</span>
                      </div>
                      <div style={{ fontSize: 12.5, color: '#d4d4d8', lineHeight: 1.45 }}>{insight.message}</div>
                    </div>
                  );
                })}
                {!data?.maintenanceInsights?.length && (
                  <div style={{ fontSize: 12.5, color: '#52525b' }}>Aucun diagnostic de maintenance pour l’instant.</div>
                )}
              </div>
            </div>

            <div style={{ borderTop: '1px solid #27272a', marginTop: 18, paddingTop: 16 }}>
              <div style={{ ...labelStyle, marginBottom: 10 }}>Records de difficulté</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 12, marginBottom: 12 }}>
                <div style={{ background: '#0f0f12', border: '1px solid #27272a', borderRadius: 10, padding: '12px 14px' }}>
                  <div style={{ fontSize: 11.5, color: '#71717a', marginBottom: 4 }}>Meilleur diff du mineur</div>
                  <div style={{ fontSize: 18, fontWeight: 700, color: '#fafafa' }}>{fmtDiff(data?.diffRecords?.minerRecord?.bestDiff)}</div>
                  <div style={{ fontSize: 11.5, color: '#52525b', marginTop: 4 }}>{data?.diffRecords?.minerRecord?.bestDiffAccountKey || 'Aucun compte'}</div>
                </div>
                <div style={{ background: '#0f0f12', border: '1px solid #27272a', borderRadius: 10, padding: '12px 14px' }}>
                  <div style={{ fontSize: 11.5, color: '#71717a', marginBottom: 4 }}>Dernier diff du mineur</div>
                  <div style={{ fontSize: 18, fontWeight: 700, color: '#fafafa' }}>{fmtDiff(data?.diffRecords?.minerRecord?.lastDiff)}</div>
                  <div style={{ fontSize: 11.5, color: '#52525b', marginTop: 4 }}>{fmtWhen(data?.diffRecords?.minerRecord?.lastDiffAt)}</div>
                </div>
                <div style={{ background: '#0f0f12', border: '1px solid #27272a', borderRadius: 10, padding: '12px 14px' }}>
                  <div style={{ fontSize: 11.5, color: '#71717a', marginBottom: 4 }}>Meilleur diff de la flotte</div>
                  <div style={{ fontSize: 18, fontWeight: 700, color: '#fafafa' }}>{fmtDiff(data?.diffRecords?.globalRecord?.bestDiff)}</div>
                  <div style={{ fontSize: 11.5, color: '#52525b', marginTop: 4 }}>{data?.diffRecords?.globalRecord?.bestDiffMinerName || 'Aucun record flotte'}</div>
                </div>
              </div>

              {data?.diffRecords?.accountRecords?.length ? (
                <div style={{ border: '1px solid #27272a', borderRadius: 10, overflow: 'hidden' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr 1fr 0.8fr', gap: 12, padding: '10px 14px', background: '#111114', color: '#71717a', fontSize: 11.5, fontWeight: 600 }}>
                    <div>Compte / Adresse</div>
                    <div>Meilleur diff</div>
                    <div>Dernier diff</div>
                    <div>Pool</div>
                  </div>
                  {data.diffRecords.accountRecords.map((record) => (
                    <div key={`${record.accountKey}-${record.updatedAt}`} style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr 1fr 0.8fr', gap: 12, padding: '12px 14px', borderTop: '1px solid #27272a', background: '#0f0f12' }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 13, color: '#fafafa', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{record.accountKey}</div>
                        <div style={{ fontSize: 11.5, color: '#52525b', marginTop: 3 }}>{fmtWhen(record.updatedAt)}</div>
                      </div>
                      <div>
                        <div style={{ fontSize: 13, color: '#fafafa', fontWeight: 600 }}>{fmtDiff(record.bestDiff)}</div>
                        <div style={{ fontSize: 11.5, color: '#52525b', marginTop: 3 }}>{fmtWhen(record.bestDiffAt)}</div>
                      </div>
                      <div>
                        <div style={{ fontSize: 13, color: '#fafafa', fontWeight: 600 }}>{fmtDiff(record.lastDiff)}</div>
                        <div style={{ fontSize: 11.5, color: '#52525b', marginTop: 3 }}>A:{fmtDiff(record.diffAccepted)} R:{fmtDiff(record.diffRejected)}</div>
                      </div>
                      <div style={{ fontSize: 12, color: '#71717a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {record.poolUrl || record.source || '—'}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ fontSize: 12.5, color: '#52525b' }}>Aucun record de diff enregistré pour ce mineur.</div>
              )}
            </div>
          </div>
        )}

        {tab === 'status' && (
          /* Advanced stats */
          <div style={{ border: '1px solid #27272a', borderRadius: 10, overflow: 'hidden' }}>
            <button
              onClick={() => setAdvancedOpen((v) => !v)}
              style={{
                width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '14px 22px', background: '#18181b', border: 'none', cursor: 'pointer',
                color: '#71717a', fontSize: 14,
              }}
            >
              <span>Stats avancées</span>
              {advancedOpen ? <ChevronUp style={{ width: 16, height: 16 }} /> : <ChevronDown style={{ width: 16, height: 16 }} />}
            </button>
            {advancedOpen && (
              <div style={{ padding: '14px 22px', background: '#18181b', borderTop: '1px solid #27272a' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px 32px' }}>
                  {[
                    ['Pool URL', activePool?.URL || '—'],
                    ['Statut du pool', activePool?.Status || '—'],
                    ['Stratum actif', activePool?.['Stratum Active'] ? 'Oui' : 'Non'],
                    ['Diff du dernier share', activePool?.['Last Share Difficulty']?.toLocaleString() || '—'],
                    ['Meilleur share', summary?.['Best Share']?.toLocaleString() || '—'],
                    ['Erreurs matérielles', summary?.['Hardware Errors']?.toString() || '0'],
                    ['Difficulté acceptée', summary?.['Difficulty Accepted']?.toFixed(0) || '—'],
                    ['Difficulté rejetée', summary?.['Difficulty Rejected']?.toFixed(0) || '—'],
                    ['Firmware', data?.firmware || '—'],
                    ['Description', data?.description || '—'],
                  ].map(([label, value]) => (
                    <div key={label}>
                      <div style={labelStyle}>{label}</div>
                      <div style={{ ...valueStyle, fontSize: 13.5, wordBreak: 'break-all' }}>{value}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Charts tab */}
        {tab === 'charts' && (
          <>
            {/* Range selector + Health score */}
            <div style={{ ...cardStyle, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                {RANGES.map((r) => (
                  <button key={r} onClick={() => setHistoryRange(r)}
                    style={{
                      padding: '5px 12px', borderRadius: 6, border: 'none', cursor: 'pointer', fontSize: 12.5, fontWeight: 500,
                      background: historyRange === r ? '#f7931a' : '#27272a',
                      color: historyRange === r ? '#fff' : '#71717a',
                      transition: 'background 0.15s',
                    }}>
                    {r}
                  </button>
                ))}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                {history?.stats && (
                  <span style={{
                    fontSize: 12, color: '#52525b',
                  }}>
                    Uptime: <span style={{ color: (history.stats.uptimeRatio * 100) >= 95 ? '#4ade80' : '#fb923c', fontWeight: 600 }}>
                      {(history.stats.uptimeRatio * 100).toFixed(1)}%
                    </span>
                  </span>
                )}
                <HealthGauge score={healthScore} />
              </div>
            </div>

            {historyLoading && !history ? (
              <div style={{ ...cardStyle, display: 'flex', justifyContent: 'center', padding: 40 }}>
                <div style={{ width: 24, height: 24, borderRadius: '50%', border: '2px solid #27272a', borderTopColor: '#f7931a', animation: 'spin 0.8s linear infinite' }} />
              </div>
            ) : history?.points?.length ? (
              <>
                {/* Sparkline charts */}
                <div style={{ ...cardStyle }}>
                  <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
                    <Sparkline
                      data={history.points.map((p) => p.hashrateTHs)}
                      label="Hashrate" unit="TH/s" color="#f7931a"
                      currentValue={history.points[history.points.length - 1]?.hashrateTHs.toFixed(2)}
                    />
                    <Sparkline
                      data={history.points.map((p) => p.tempAvg)}
                      label="Température" unit="°C" color="#fb923c"
                      currentValue={history.points[history.points.length - 1]?.tempAvg.toFixed(0)}
                    />
                    <Sparkline
                      data={history.points.map((p) => p.powerW)}
                      label="Conso" unit="W" color="#60a5fa"
                      currentValue={history.points[history.points.length - 1]?.powerW.toFixed(0)}
                    />
                  </div>
                </div>

                {/* Stats summary */}
                <div style={cardStyle}>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16 }}>
                    {[
                      { label: 'Hashrate moyen', value: `${history.stats.avgHashrate.toFixed(2)} TH/s` },
                      { label: 'Temp moyenne', value: `${history.stats.avgTemp.toFixed(1)}°C` },
                      { label: 'Conso moyenne', value: `${history.stats.avgPower.toFixed(0)} W` },
                      { label: 'Rejetés', value: `${history.stats.rejectedTotal.toLocaleString()} (${history.stats.acceptedTotal + history.stats.rejectedTotal > 0 ? ((history.stats.rejectedTotal / (history.stats.acceptedTotal + history.stats.rejectedTotal)) * 100).toFixed(2) : '0'}%)` },
                    ].map(({ label, value }) => (
                      <div key={label}>
                        <div style={labelStyle}>{label}</div>
                        <div style={{ fontSize: 16, fontWeight: 600, color: '#fafafa' }}>{value}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            ) : (
              <div style={{ ...cardStyle, textAlign: 'center', padding: 40, color: '#52525b' }}>
                Aucune donnée de télémétrie sur cette plage.
              </div>
            )}
          </>
        )}

        {tab === 'timeline' && (
          <div style={cardStyle}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
              <div>
                <h3 style={{ fontSize: 15, fontWeight: 600, color: '#fafafa', margin: 0 }}>Historique des événements</h3>
                <p style={{ fontSize: 12.5, color: '#71717a', margin: '6px 0 0' }}>Transitions système, alertes, actions manuelles et maintenance auto.</p>
              </div>
              <span style={{ fontSize: 12, color: '#52525b' }}>{events.length} événements</span>
            </div>

            {eventsLoading && events.length === 0 ? (
              <div style={{ display: 'flex', justifyContent: 'center', padding: 32 }}>
                <div style={{ width: 24, height: 24, borderRadius: '50%', border: '2px solid #27272a', borderTopColor: '#f7931a', animation: 'spin 0.8s linear infinite' }} />
              </div>
            ) : events.length === 0 ? (
              <div style={{ textAlign: 'center', padding: 40, color: '#52525b' }}>Aucun événement enregistré pour ce mineur.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {events.map((event, index) => {
                  const colors = eventColor(event.severity);
                  return (
                    <div key={`${event.ts}-${event.type}-${index}`} style={{
                      display: 'flex', alignItems: 'flex-start', gap: 12, padding: '12px 14px', borderRadius: 10,
                      background: '#0f0f12', border: '1px solid #27272a',
                    }}>
                      <div style={{ width: 10, height: 10, borderRadius: '50%', marginTop: 6, flexShrink: 0, background: colors.color }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
                          <span style={{
                            fontSize: 10.5, fontWeight: 600, padding: '2px 8px', borderRadius: 9999,
                            background: colors.bg, border: `1px solid ${colors.border}`, color: colors.color,
                          }}>
                            {eventLabel(event)}
                          </span>
                          <span style={{ fontSize: 11.5, color: '#52525b' }}>{formatEventTime(event.ts)}</span>
                        </div>
                        <div style={{ fontSize: 13.5, color: '#e4e4e7', lineHeight: 1.45 }}>{event.message}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {tab === 'settings' && (
          <div style={cardStyle}>
            <h3 style={{ fontSize: 15, fontWeight: 600, color: '#fafafa', marginBottom: 18 }}>Réglages du mineur</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {[
                { label: 'Nom', key: 'name' as const, placeholder: 'Nom du mineur' },
                { label: 'Port', key: 'port' as const, placeholder: '4028' },
              ].map(({ label, key, placeholder }) => (
                <label key={key} style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                  <span style={{ fontSize: 12.5, color: '#71717a' }}>{label}</span>
                  <input value={settingsForm[key]}
                    onChange={(e) => setSettingsForm((f) => ({ ...f, [key]: e.target.value }))}
                    placeholder={placeholder}
                    style={{ background: '#09090b', border: '1px solid #27272a', borderRadius: 7, padding: '8px 12px', color: '#fafafa', fontSize: 14, outline: 'none', maxWidth: 360 }} />
                </label>
              ))}
            </div>
            <button onClick={saveSettings}
              style={{ marginTop: 18, padding: '9px 20px', background: '#f7931a', border: 'none', borderRadius: 8, color: '#fff', fontSize: 14, fontWeight: 500, cursor: 'pointer' }}>
              Enregistrer
            </button>
          </div>
        )}
      </div>
    </>
  );
}
