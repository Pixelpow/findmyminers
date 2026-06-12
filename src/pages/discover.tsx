import { useEffect, useMemo, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { ArrowLeft, ArrowRight, Check, Cpu, Loader2, RefreshCw, Search, ShieldCheck } from 'lucide-react';
import { appCardStyle } from '@/lib/styles';

type DiscoveredMiner = {
  id: string;
  name: string;
  ip: string;
  port: number;
  model?: string;
  firmware?: string;
  protocol?: 'cgminer' | 'axeos' | 'whatsminer' | 'antminer';
  source?: 'cgminer' | 'axeos' | 'whatsminer' | 'antminer' | string;
  hashrateTHs?: number;
  tempC?: number;
  powerW?: number;
  deviceType?: string;
  chipType?: string;
  fanRpm?: number;
  uptime?: number;
  accepted?: number;
  rejected?: number;
  poolUrl?: string;
};

type ConfigMiner = {
  id: string;
  name: string;
  ip: string;
  port: number;
  enabled: boolean;
  model?: string;
};

type WizardMiner = DiscoveredMiner & {
  selected: boolean;
  duplicate: boolean;
  customName: string;
};

type WizardStep = 'scan' | 'select' | 'review' | 'done';



function RadarAnimation({ size = 160 }: { size?: number }) {
  const cx = size / 2;
  const r1 = size * 0.15;
  const r2 = size * 0.28;
  const r3 = size * 0.42;

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ display: 'block', margin: '0 auto' }}>
      {[r1, r2, r3].map((radius, index) => (
        <circle key={index} cx={cx} cy={cx} r={radius} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="1" opacity={0.7 - index * 0.15} />
      ))}
      <line x1={cx} y1={cx - r3 - 4} x2={cx} y2={cx + r3 + 4} stroke="rgba(255,255,255,0.08)" strokeWidth="0.5" />
      <line x1={cx - r3 - 4} y1={cx} x2={cx + r3 + 4} y2={cx} stroke="rgba(255,255,255,0.08)" strokeWidth="0.5" />
      <defs>
        <linearGradient id="radarGrad" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#f7931a" stopOpacity="0" />
          <stop offset="100%" stopColor="#f7931a" stopOpacity="0.45" />
        </linearGradient>
      </defs>
      <g style={{ transformOrigin: `${cx}px ${cx}px`, animation: 'radarSweep 2.2s linear infinite' }}>
        <path
          d={`M ${cx} ${cx} L ${cx} ${cx - r3} A ${r3} ${r3} 0 0 1 ${cx + r3 * Math.sin(Math.PI / 4)} ${cx - r3 * Math.cos(Math.PI / 4)} Z`}
          fill="url(#radarGrad)"
        />
        <line x1={cx} y1={cx} x2={cx} y2={cx - r3} stroke="#f7931a" strokeWidth="1.5" strokeLinecap="round" opacity="0.9" />
      </g>
      <circle cx={cx} cy={cx} r="3" fill="#f7931a">
        <animate attributeName="opacity" values="1;0.4;1" dur="1.5s" repeatCount="indefinite" />
      </circle>
    </svg>
  );
}

function StatCard({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent: string }) {
  return (
    <div className="glass-panel" style={{ padding: '16px 18px', minWidth: 160, flex: 1, overflow: 'hidden', position: 'relative' }}>
      <div style={{ position: 'absolute', right: -16, bottom: -24, width: 80, height: 80, borderRadius: '50%', background: `${accent}12`, filter: 'blur(10px)' }} />
      <div style={{ position: 'relative' }}>
        <div className="label-micro" style={{ marginBottom: 8 }}>{label}</div>
        <div className="metric-value">{value}</div>
        {sub && <div style={{ fontSize: 12, color: 'var(--muted-2)', marginTop: 6 }}>{sub}</div>}
      </div>
    </div>
  );
}

function StepChip({ active, done, label, number }: { active: boolean; done: boolean; label: string; number: number }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div style={{
        width: 24,
        height: 24,
        borderRadius: '50%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 12,
        fontWeight: 700,
        background: done || active ? '#f7931a' : 'rgba(255,255,255,0.03)',
        color: done || active ? '#09090b' : 'var(--muted)',
        border: `1px solid ${done || active ? '#f7931a' : 'var(--border-1)'}`,
      }}>
        {done ? <Check style={{ width: 12, height: 12 }} /> : number}
      </div>
      <span style={{ fontSize: 12.5, color: active ? 'var(--foreground)' : 'var(--muted)', fontWeight: active ? 700 : 500 }}>{label}</span>
    </div>
  );
}

function capabilityLabel(miner: DiscoveredMiner) {
  if (miner.source === 'axeos') return 'AxeOS HTTP';
  if (miner.source === 'cgminer') return 'CGMiner TCP';
  return 'Detected';
}

function recommendedProfile(miner: DiscoveredMiner) {
  if ((miner.tempC || 0) >= 82) return 'Eco';
  if ((miner.powerW || 0) >= 120) return 'Balanced';
  return 'Performance';
}

export default function DiscoverPage() {
  const [subnet, setSubnet] = useState('');
  const [portStr, setPortStr] = useState('4028');
  const [fromStr, setFromStr] = useState('1');
  const [toStr, setToStr] = useState('254');
  const [step, setStep] = useState<WizardStep>('scan');
  const [scanning, setScanning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [existingMiners, setExistingMiners] = useState<ConfigMiner[]>([]);
  const [wizardMiners, setWizardMiners] = useState<WizardMiner[]>([]);
  const [addedIds, setAddedIds] = useState<string[]>([]);

  useEffect(() => {
    const loadConfig = async () => {
      try {
        const res = await fetch('/api/miner/config');
        if (!res.ok) return;
        const json = await res.json();
        setExistingMiners(Array.isArray(json.miners) ? json.miners as ConfigMiner[] : []);
      } catch {
        /* ignore */
      }
    };

    loadConfig();
  }, []);

  const selectedMiners = useMemo(() => wizardMiners.filter((miner) => miner.selected && !miner.duplicate), [wizardMiners]);
  const duplicateCount = useMemo(() => wizardMiners.filter((miner) => miner.duplicate).length, [wizardMiners]);
  const bitaxeCount = useMemo(() => wizardMiners.filter((miner) => miner.deviceType === 'bitaxe').length, [wizardMiners]);

  const handleScan = async () => {
    setScanning(true);
    setError('');
    setStep('scan');
    setAddedIds([]);

    try {
      const body: Record<string, number | string> = {};
      if (subnet.trim()) body.subnet = subnet.trim();
      if (fromStr) body.from = Number(fromStr);
      if (toStr) body.to = Number(toStr);
      if (portStr) body.port = Number(portStr);

      const res = await fetch('/api/miner/discover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: 'Discovery failed' }));
        throw new Error(typeof data.error === 'string' ? data.error : 'Discovery failed');
      }

      const data = await res.json();
      const discovered = Array.isArray(data.miners) ? data.miners as DiscoveredMiner[] : [];
      const nextWizardMiners: WizardMiner[] = discovered.map((miner) => {
        const duplicate = existingMiners.some((existing) => existing.ip === miner.ip && existing.port === miner.port);
        return {
          ...miner,
          duplicate,
          selected: !duplicate,
          customName: miner.name || miner.model || miner.ip,
        };
      });

      setWizardMiners(nextWizardMiners);
      if (!subnet.trim() && typeof data.subnet === 'string' && data.subnet) {
        setSubnet(data.subnet);
      }
      setStep(nextWizardMiners.length ? 'select' : 'scan');
    } catch (scanError) {
      // fetch network failures surface as TypeError ("Failed to fetch") — the
      // backend is unreachable while the service worker keeps the UI alive.
      setError(scanError instanceof TypeError
        ? 'Serveur injoignable — vérifie que l\'application est bien lancée, puis réessaie.'
        : scanError instanceof Error ? scanError.message : 'Échec du scan');
      setWizardMiners([]);
    } finally {
      setScanning(false);
    }
  };

  const updateWizardMiner = (minerId: string, patch: Partial<WizardMiner>) => {
    setWizardMiners((current) => current.map((miner) => miner.id === minerId ? { ...miner, ...patch } : miner));
  };

  const saveSelectedMiners = async () => {
    if (!selectedMiners.length) return;

    setSaving(true);
    setError('');

    try {
      const configRes = await fetch('/api/miner/config');
      if (!configRes.ok) throw new Error('Failed to read config');
      const config = await configRes.json();
      const currentMiners = Array.isArray(config.miners) ? config.miners as ConfigMiner[] : [];

      const existingPairs = new Set(currentMiners.map((miner) => `${miner.ip}:${miner.port}`));
      const toCreate = selectedMiners
        .filter((miner) => !existingPairs.has(`${miner.ip}:${miner.port}`))
        .map((miner) => ({
          id: miner.id,
          name: miner.customName.trim() || miner.name || miner.model || miner.ip,
          ip: miner.ip,
          port: miner.port,
          enabled: true,
          model: miner.model,
          protocol: miner.protocol,
        }));

      const updateRes = await fetch('/api/miner/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ miners: [...currentMiners, ...toCreate] }),
      });

      if (!updateRes.ok) throw new Error('Failed to save miners');

      setAddedIds(toCreate.map((miner) => miner.id));
      setExistingMiners([...currentMiners, ...toCreate]);
      setStep('done');
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Failed to save miners');
    } finally {
      setSaving(false);
    }
  };

  const canReview = selectedMiners.length > 0;
  const inputStyle: React.CSSProperties = {
    width: '100%',
    height: 44,
    padding: '0 14px',
    borderRadius: 14,
    border: '1px solid var(--border-1)',
    background: 'rgba(255,255,255,0.03)',
    color: 'var(--foreground)',
    fontSize: 13,
    outline: 'none',
  };
  const ghostButton: React.CSSProperties = {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
    height: 42, padding: '0 16px', borderRadius: 14,
    border: '1px solid var(--border-1)', background: 'rgba(255,255,255,0.04)',
    color: 'var(--foreground)', cursor: 'pointer', fontSize: 12.5, fontWeight: 700,
  };
  const primaryButton: React.CSSProperties = {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
    height: 42, padding: '0 16px', borderRadius: 14,
    border: '1px solid rgba(247,147,26,0.22)',
    background: 'linear-gradient(180deg, rgba(247,147,26,0.94) 0%, rgba(214,118,11,0.94) 100%)',
    color: '#11131a', cursor: 'pointer', fontSize: 12.5, fontWeight: 800,
  };

  return (
    <>
      <Head><title>Discover | FindMyMiners</title></Head>
      <div style={{ maxWidth: 1180 }}>
        <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', marginBottom: 22 }}>
          <StepChip number={1} label="Scan" active={step === 'scan'} done={step !== 'scan'} />
          <StepChip number={2} label="Select" active={step === 'select'} done={step === 'review' || step === 'done'} />
          <StepChip number={3} label="Review" active={step === 'review'} done={step === 'done'} />
          <StepChip number={4} label="Add" active={step === 'done'} done={step === 'done'} />
        </div>

        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 22 }}>
          <StatCard label="Configured miners" value={String(existingMiners.length)} sub="Already saved in this org" accent="#6aa7ff" />
          <StatCard label="Discovered" value={String(wizardMiners.length)} sub="Last network scan" accent="#f59e0b" />
          <StatCard label="Ready to add" value={String(selectedMiners.length)} sub={duplicateCount ? `${duplicateCount} duplicate${duplicateCount > 1 ? 's' : ''} skipped` : 'No duplicates detected'} accent="#4ade80" />
          <StatCard label="Bitaxe family" value={String(bitaxeCount)} sub="Detected via AxeOS or CGMiner" accent="#fb7185" />
        </div>

        <div style={{ ...appCardStyle(28, '20px 22px'), marginBottom: 18 }}>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div>
              <label style={{ display: 'block', fontSize: 11.5, color: 'var(--muted)', marginBottom: 6 }}>Subnet</label>
              <input value={subnet} onChange={(event) => setSubnet(event.target.value)} placeholder="e.g. 192.168.1"
                style={{ ...inputStyle, width: 170 }} />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 11.5, color: 'var(--muted)', marginBottom: 6 }}>From</label>
              <input value={fromStr} onChange={(event) => setFromStr(event.target.value)}
                style={{ ...inputStyle, width: 70, textAlign: 'center' }} />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 11.5, color: 'var(--muted)', marginBottom: 6 }}>To</label>
              <input value={toStr} onChange={(event) => setToStr(event.target.value)}
                style={{ ...inputStyle, width: 70, textAlign: 'center' }} />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 11.5, color: 'var(--muted)', marginBottom: 6 }}>Port</label>
              <input value={portStr} onChange={(event) => setPortStr(event.target.value)}
                style={{ ...inputStyle, width: 78, textAlign: 'center' }} />
            </div>
            <button onClick={handleScan} disabled={scanning}
              style={{ ...primaryButton, opacity: scanning ? 0.7 : 1, cursor: scanning ? 'default' : 'pointer' }}>
              {scanning ? <Loader2 style={{ width: 14, height: 14, animation: 'spin 1s linear infinite' }} /> : <Search style={{ width: 14, height: 14 }} />}
              {scanning ? 'Scanning…' : 'Scan Network'}
            </button>
          </div>
        </div>

        {error && (
          <div style={{ padding: '12px 14px', borderRadius: 14, background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.25)', color: '#f87171', fontSize: 13, marginBottom: 18 }}>
            {error}
          </div>
        )}

        {scanning && (
          <div style={{ ...appCardStyle(28, '40px 24px 32px'), textAlign: 'center', marginBottom: 18 }}>
            <RadarAnimation size={180} />
            <p style={{ fontSize: 14, color: 'var(--foreground)', marginTop: 18, fontWeight: 700 }}>Scanning network…</p>
            <p style={{ fontSize: 12.5, color: 'var(--muted-2)', marginTop: 4 }}>Probing {subnet || 'local'}.{fromStr}–{toStr} on port {portStr}</p>
          </div>
        )}

        {!scanning && step === 'scan' && wizardMiners.length === 0 && (
          <div style={{ ...appCardStyle(28, '46px 24px'), textAlign: 'center' }}>
            <ShieldCheck style={{ width: 30, height: 30, color: 'var(--accent-strong)', margin: '0 auto 12px' }} />
            <div style={{ fontSize: 16, color: 'var(--foreground)', marginBottom: 6, fontWeight: 700 }}>Start with a guided network scan</div>
            <div style={{ fontSize: 13, color: 'var(--muted)' }}>The wizard will detect miners, skip duplicates and prepare them for import.</div>
          </div>
        )}

        {!scanning && step === 'select' && (
          <div style={appCardStyle(28, '20px 22px')}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, gap: 12, flexWrap: 'wrap' }}>
              <div>
                <h2 style={{ fontSize: 18, fontWeight: 700, color: 'var(--foreground)', margin: 0 }}>Select devices to onboard</h2>
                <p style={{ fontSize: 12.5, color: 'var(--muted)', margin: '6px 0 0' }}>Duplicates are detected automatically and excluded by default.</p>
              </div>
              <button onClick={() => setWizardMiners((current) => current.map((miner) => miner.duplicate ? miner : { ...miner, selected: true }))}
                style={ghostButton}>
                Select all eligible
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {wizardMiners.map((miner) => (
                <div key={miner.id} style={{ border: '1px solid var(--border-1)', borderRadius: 18, background: miner.selected ? 'rgba(247,147,26,0.08)' : 'rgba(255,255,255,0.02)', padding: '14px 16px' }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                    <input type="checkbox" checked={miner.selected} disabled={miner.duplicate}
                      onChange={(event) => updateWizardMiner(miner.id, { selected: event.target.checked })}
                      style={{ marginTop: 4, accentColor: '#f7931a' }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 5 }}>
                        <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--foreground)' }}>{miner.name}</span>
                        <span style={{ fontSize: 10.5, color: 'var(--muted)', padding: '2px 7px', borderRadius: 9999, background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border-1)' }}>{capabilityLabel(miner)}</span>
                        {miner.model && <span style={{ fontSize: 10.5, color: '#bfdbfe', padding: '2px 7px', borderRadius: 9999, background: 'rgba(106,167,255,0.12)', border: '1px solid rgba(106,167,255,0.18)' }}>{miner.model}</span>}
                        {miner.duplicate && <span style={{ fontSize: 10.5, color: '#f87171', padding: '2px 7px', borderRadius: 9999, background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.2)' }}>Already configured</span>}
                      </div>
                      <div style={{ fontSize: 12.5, color: 'var(--muted)', display: 'flex', gap: 14, flexWrap: 'wrap' }}>
                        <span>{miner.ip}:{miner.port}</span>
                        {miner.hashrateTHs != null && <span>{miner.hashrateTHs.toFixed(4)} TH/s</span>}
                        {miner.tempC != null && <span>{miner.tempC.toFixed(0)}°C</span>}
                        {miner.powerW != null && <span>{miner.powerW.toFixed(0)}W</span>}
                        {miner.poolUrl && <span>{miner.poolUrl}</span>}
                      </div>
                    </div>
                    <div style={{ fontSize: 11.5, color: 'var(--muted-2)', whiteSpace: 'nowrap' }}>Recommended: {recommendedProfile(miner)}</div>
                  </div>
                </div>
              ))}
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 18 }}>
              <button onClick={() => setStep('scan')}
                style={ghostButton}>
                <ArrowLeft style={{ width: 14, height: 14 }} /> Back
              </button>
              <button onClick={() => canReview && setStep('review')} disabled={!canReview}
                style={{ ...primaryButton, opacity: canReview ? 1 : 0.55, cursor: canReview ? 'pointer' : 'default' }}>
                Review selection <ArrowRight style={{ width: 14, height: 14 }} />
              </button>
            </div>
          </div>
        )}

        {!scanning && step === 'review' && (
          <div style={appCardStyle(28, '20px 22px')}>
            <div style={{ marginBottom: 16 }}>
              <h2 style={{ fontSize: 18, fontWeight: 700, color: 'var(--foreground)', margin: 0 }}>Review before import</h2>
              <p style={{ fontSize: 12.5, color: 'var(--muted)', margin: '6px 0 0' }}>Adjust names if needed. Each selected miner will be added enabled and ready for polling.</p>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {selectedMiners.map((miner) => (
                <div key={miner.id} style={{ border: '1px solid var(--border-1)', borderRadius: 18, background: 'rgba(255,255,255,0.02)', padding: '14px 16px' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: 'minmax(180px, 1.2fr) minmax(220px, 1.8fr) minmax(140px, 1fr)', gap: 12, alignItems: 'center' }}>
                    <div>
                      <div style={{ fontSize: 11.5, color: 'var(--muted)', marginBottom: 4 }}>Detected device</div>
                      <div style={{ fontSize: 13.5, color: 'var(--foreground)', fontWeight: 700 }}>{miner.model || miner.name}</div>
                      <div style={{ fontSize: 12, color: 'var(--muted-2)', marginTop: 3 }}>{miner.ip}:{miner.port}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: 11.5, color: 'var(--muted)', marginBottom: 4 }}>Name in dashboard</div>
                      <input value={miner.customName} onChange={(event) => updateWizardMiner(miner.id, { customName: event.target.value })}
                        style={inputStyle} />
                    </div>
                    <div>
                      <div style={{ fontSize: 11.5, color: 'var(--muted)', marginBottom: 4 }}>Suggested profile</div>
                      <div style={{ fontSize: 13, color: 'var(--foreground)' }}>{recommendedProfile(miner)}</div>
                      <div style={{ fontSize: 11.5, color: 'var(--muted-2)', marginTop: 3 }}>{capabilityLabel(miner)}</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 18 }}>
              <button onClick={() => setStep('select')}
                style={ghostButton}>
                <ArrowLeft style={{ width: 14, height: 14 }} /> Back
              </button>
              <button onClick={saveSelectedMiners} disabled={saving || !selectedMiners.length}
                style={{ ...primaryButton, opacity: saving || !selectedMiners.length ? 0.6 : 1, cursor: saving || !selectedMiners.length ? 'default' : 'pointer' }}>
                {saving ? <Loader2 style={{ width: 14, height: 14, animation: 'spin 1s linear infinite' }} /> : <Cpu style={{ width: 14, height: 14 }} />}
                {saving ? 'Adding…' : `Add ${selectedMiners.length} miner${selectedMiners.length > 1 ? 's' : ''}`}
              </button>
            </div>
          </div>
        )}

        {!scanning && step === 'done' && (
          <div style={{ ...appCardStyle(28, '34px 24px'), textAlign: 'center' }}>
            <div style={{ width: 54, height: 54, borderRadius: '50%', background: 'rgba(34,197,94,0.12)', border: '1px solid rgba(34,197,94,0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 14px' }}>
              <Check style={{ width: 24, height: 24, color: '#4ade80' }} />
            </div>
            <div style={{ fontSize: 19, fontWeight: 700, color: 'var(--foreground)', marginBottom: 6 }}>Onboarding complete</div>
            <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 18 }}>{addedIds.length} miner{addedIds.length > 1 ? 's have' : ' has'} been added to your dashboard configuration.</div>
            <div style={{ display: 'flex', justifyContent: 'center', gap: 10, flexWrap: 'wrap' }}>
              <button onClick={() => setStep('scan')}
                style={ghostButton}>
                <RefreshCw style={{ width: 14, height: 14 }} /> Scan again
              </button>
              <Link href="/miners" style={{ ...primaryButton, textDecoration: 'none' }}>
                Open miners list <ArrowRight style={{ width: 14, height: 14 }} />
              </Link>
            </div>
          </div>
        )}
      </div>

      <style jsx global>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @keyframes radarSweep { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>
    </>
  );
}
