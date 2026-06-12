import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import { MoreVertical, Moon, Download, RotateCcw, PlaneTakeoff, Wallet, Plus, Trash2, Settings2, Users, Bot, ShieldAlert, Sliders } from 'lucide-react';
import { useToast } from '@/components/ToastProvider';
import { appCardStyle } from '@/lib/styles';

type SettingsTab = 'general' | 'members' | 'agent' | 'night-mode' | 'automation' | 'wallets' | 'preferences';
type MembersTab = 'active' | 'pending';
type AgentData = {
  type?: string;
  version?: string;
  platform?: string;
  latestVersion?: string;
  updateAvailable?: boolean;
  hostname?: string;
  publicIp?: string;
  localIp?: string;
  lastSeen?: number;
  online?: boolean;
};

type AgentPlatform = {
  filename: string;
  available: boolean;
  size?: number | null;
  downloadUrl: string;
};

type AgentVersionResponse = {
  version: string;
  platforms: Record<string, AgentPlatform>;
};

type AppVersionResponse = {
  name: string;
  version: string;
  deployment: string;
  ts: number;
};

type NightSchedule = {
  enabled: boolean;
  startHour: number;
  endHour: number;
  fanPercent: number;
  workMode: string;
};



export default function SettingsPage() {
  const router = useRouter();
  const { toast } = useToast();
  const [tab, setTab] = useState<SettingsTab>('general');
  const [orgName, setOrgName] = useState('MiningFarm');
  const [, setSavedOrgName] = useState('MiningFarm');
  const [membersTab, setMembersTab] = useState<MembersTab>('active');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('Member');
  const [agentData, setAgentData] = useState<AgentData | null>(null);
  const [agentVersion, setAgentVersion] = useState<string>('');
  const [agentPlatforms, setAgentPlatforms] = useState<Record<string, AgentPlatform>>({});
  const [appVersion, setAppVersion] = useState('');
  const [authUser, setAuthUser] = useState<{ name: string; email: string } | null>(null);
  const [nightSchedule, setNightSchedule] = useState<NightSchedule>({ enabled: false, startHour: 22, endHour: 7, fanPercent: 40, workMode: '0' });
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [savingGeneral, setSavingGeneral] = useState(false);
  const [savingNight, setSavingNight] = useState(false);
  const [savingAutomation, setSavingAutomation] = useState(false);
  const [walletAddress, setWalletAddress] = useState('');
  const [wallets, setWallets] = useState<Array<{ address: string; balanceBtc: number; error?: string | null }>>([]);
  const [autoRebootEnabled, setAutoRebootEnabled] = useState(false);
  const [vacationModeEnabled, setVacationModeEnabled] = useState(false);

  useEffect(() => {
    if (!router.isReady) return;
    const current = router.query.tab as string;
    if (current && ['general', 'members', 'agent', 'night-mode', 'automation', 'wallets', 'preferences'].includes(current)) {
      setTab(current as SettingsTab);
      return;
    }
    setTab('general');
  }, [router.isReady, router.query.tab]);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/auth/me');
        if (!res.ok) return;
        const json = await res.json();
        setAuthUser(json.user || null);
        const org = json.organization || json.organizations?.[0];
        if (org) {
          setOrgName(org.name || 'MiningFarm');
          setSavedOrgName(org.name || 'MiningFarm');
        }
      } catch { /* ignore */ }
    })();

    (async () => {
      try {
        const res = await fetch('/api/miner/config');
        if (!res.ok) return;
        const config = await res.json();
        if (config.nightSchedule) setNightSchedule(config.nightSchedule);
        setAutoRebootEnabled(!!config.autoReboot?.enabled);
        setVacationModeEnabled(!!config.vacationMode?.enabled);
      } catch { /* ignore */ }
    })();

    (async () => {
      try {
        const res = await fetch('/api/miner/wallet');
        if (!res.ok) return;
        const json = await res.json();
        setWallets(json.wallets || []);
      } catch { /* ignore */ }
    })();

    (async () => {
      try {
        const res = await fetch('/api/agent/heartbeat');
        if (!res.ok) return;
        const json = await res.json();
        const agents = json.agents || [];
        if (agents.length > 0) {
          const agent = agents[0];
          setAgentData({
            type: agent.type || 'Software',
            version: agent.version || '—',
            platform: agent.platform || '—',
            latestVersion: agent.latestVersion || undefined,
            updateAvailable: agent.updateAvailable === true,
            hostname: agent.hostname || agent.name || '—',
            publicIp: agent.publicIp || '—',
            localIp: agent.localIp || agent.ip || '—',
            lastSeen: agent.lastSeen || agent.ts,
            online: Date.now() - (agent.lastSeen || agent.ts || 0) < 120_000,
          });
        }
      } catch { /* ignore */ }
    })();

    (async () => {
      try {
        const res = await fetch('/api/agent/version');
        if (!res.ok) return;
        const json = await res.json() as AgentVersionResponse;
        setAgentVersion(json.version || '');
        setAgentPlatforms(json.platforms || {});
      } catch { /* ignore */ }
    })();

    (async () => {
      try {
        const res = await fetch('/api/app/version');
        if (!res.ok) return;
        const json = await res.json() as AppVersionResponse;
        setAppVersion(json.version || '');
      } catch { /* ignore */ }
    })();
  }, []);

  const saveGeneral = async () => {
    setSavingGeneral(true);
    try {
      setSavedOrgName(orgName);
      await fetch('/api/miner/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ orgName }) });
    } catch { /* ignore */ }
    finally { setSavingGeneral(false); toast('success', 'Settings saved'); }
  };

  const saveAutomation = async () => {
    setSavingAutomation(true);
    try {
      await fetch('/api/miner/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ autoReboot: { enabled: autoRebootEnabled }, vacationMode: { enabled: vacationModeEnabled } }),
      });
    } catch { /* ignore */ }
    finally { setSavingAutomation(false); toast('success', 'Automation settings saved'); }
  };

  const saveNightSchedule = async () => {
    setSavingNight(true);
    try {
      await fetch('/api/miner/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nightSchedule }),
      });
    } catch { /* ignore */ }
    finally { setSavingNight(false); toast('success', 'Night schedule saved'); }
  };

  const addWallet = async () => {
    if (!walletAddress.trim()) return;
    try {
      const res = await fetch('/api/miner/wallet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address: walletAddress.trim() }),
      });
      if (!res.ok) return;
      const refreshed = await fetch('/api/miner/wallet');
      if (refreshed.ok) {
        const json = await refreshed.json();
        setWallets(json.wallets || []);
      }
      setWalletAddress('');
    } catch { /* ignore */ }
  };

  const removeWallet = async (address: string) => {
    try {
      const res = await fetch('/api/miner/wallet', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address }),
      });
      if (!res.ok) return;
      setWallets((current) => current.filter((wallet) => wallet.address !== address));
    } catch { /* ignore */ }
  };

  const deleteOrg = async () => {
    try {
      await fetch('/api/miner/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ miners: [], selectedMinerId: '' }),
      });
      setDeleteConfirm(false);
      router.push('/');
    } catch { /* ignore */ }
  };

  const switchTab = (nextTab: SettingsTab) => {
    setTab(nextTab);
    void router.replace({ pathname: router.pathname, query: nextTab === 'general' ? {} : { tab: nextTab } }, undefined, { shallow: true });
  };

  const inputStyle: React.CSSProperties = {
    width: '100%',
    height: 44,
    padding: '0 14px',
    borderRadius: 14,
    border: '1px solid var(--border-1)',
    background: 'rgba(255,255,255,0.03)',
    color: 'var(--foreground)',
    outline: 'none',
  };

  const primaryButton: React.CSSProperties = {
    height: 44,
    padding: '0 18px',
    borderRadius: 14,
    border: '1px solid rgba(247,147,26,0.22)',
    background: 'linear-gradient(180deg, rgba(247,147,26,0.94) 0%, rgba(214,118,11,0.94) 100%)',
    color: '#11131a',
    fontWeight: 800,
    cursor: 'pointer',
  };

  const ghostButton: React.CSSProperties = {
    height: 42,
    padding: '0 16px',
    borderRadius: 14,
    border: '1px solid var(--border-1)',
    background: 'rgba(255,255,255,0.04)',
    color: 'var(--foreground)',
    cursor: 'pointer',
  };

  const tabMeta: Array<{ id: SettingsTab; label: string; icon: React.ComponentType<{ style?: React.CSSProperties }> }> = [
    { id: 'general', label: 'General', icon: Settings2 },
    { id: 'preferences', label: 'Preferences', icon: Sliders },
    { id: 'night-mode', label: 'Night Mode', icon: Moon },
    { id: 'automation', label: 'Automation', icon: RotateCcw },
    { id: 'wallets', label: 'Wallets', icon: Wallet },
    { id: 'members', label: 'Members', icon: Users },
    { id: 'agent', label: 'Agent', icon: Bot },
  ];

  return (
    <>
      <Head><title>Settings | FindMyMiners</title></Head>
      <div>
        <section style={{ display: 'grid', gridTemplateColumns: '260px minmax(0, 1fr)', gap: 16 }}>
          <aside className="glass-panel" style={{ padding: 12 }}>
            <div style={{ display: 'grid', gap: 6 }}>
              {tabMeta.map(({ id, label, icon: Icon }) => {
                const active = tab === id;
                return (
                  <button
                    key={id}
                    onClick={() => switchTab(id)}
                    style={{
                      height: 46,
                      padding: '0 14px',
                      borderRadius: 16,
                      border: active ? '1px solid rgba(247,147,26,0.18)' : '1px solid transparent',
                      background: active ? 'linear-gradient(180deg, rgba(255,255,255,0.08) 0%, rgba(255,255,255,0.04) 100%)' : 'transparent',
                      color: active ? 'var(--foreground)' : 'var(--muted)',
                      boxShadow: active ? 'var(--shadow-glow)' : 'none',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      cursor: 'pointer',
                      fontWeight: active ? 700 : 600,
                      textAlign: 'left',
                    }}
                  >
                    <Icon style={{ width: 16, height: 16, color: active ? 'var(--accent-strong)' : 'var(--muted-2)' }} />
                    {label}
                  </button>
                );
              })}
            </div>
          </aside>

          <div style={{ display: 'grid', gap: 16 }}>
            {tab === 'general' && (
              <>
                <section style={appCardStyle(28, '24px')}>
                  <div style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--muted-2)', marginBottom: 8 }}>Organization</div>
                  <h2 style={{ margin: '0 0 8px', fontSize: 22, color: 'var(--foreground)' }}>Workspace identity</h2>
                  <p style={{ margin: '0 0 18px', fontSize: 13.5, color: 'var(--muted)', lineHeight: 1.65 }}>Keep the workspace name clean and recognizable across the dashboard, alerts and agent pages.</p>
                  <label style={{ display: 'block', fontSize: 12.5, color: 'var(--muted)', marginBottom: 8 }}>Farm Name</label>
                  <input value={orgName} onChange={(event) => setOrgName(event.target.value)} style={{ ...inputStyle, maxWidth: 440 }} />
                  <div style={{ marginTop: 18 }}>
                    <button onClick={saveGeneral} disabled={savingGeneral} style={primaryButton}>{savingGeneral ? 'Saving...' : 'Save Settings'}</button>
                  </div>
                </section>

                <section style={appCardStyle(28, '24px')}>
                  <div style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--muted-2)', marginBottom: 8 }}>Deployment</div>
                  <h2 style={{ margin: '0 0 8px', fontSize: 22, color: 'var(--foreground)' }}>Application version</h2>
                  <p style={{ margin: '0 0 18px', fontSize: 13.5, color: 'var(--muted)', lineHeight: 1.65 }}>This is the currently deployed dashboard version. Web app updates are deployed server-side and picked up automatically by the client.</p>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '14px 16px', borderRadius: 18, background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border-1)' }}>
                    <span style={{ fontSize: 13, color: 'var(--muted)' }}>Dashboard build</span>
                    <span style={{ fontSize: 13, color: 'var(--foreground)', fontWeight: 700 }}>{appVersion ? `v${appVersion}` : 'Unknown'}</span>
                  </div>
                </section>

                <section style={{ ...appCardStyle(28, '24px'), border: '1px solid rgba(248,113,113,0.18)', background: 'linear-gradient(180deg, rgba(53,18,21,0.55) 0%, rgba(21,13,16,0.92) 100%)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                    <ShieldAlert style={{ width: 16, height: 16, color: '#fca5a5' }} />
                    <h2 style={{ margin: 0, fontSize: 20, color: 'var(--foreground)' }}>Danger zone</h2>
                  </div>
                  <p style={{ margin: '0 0 18px', fontSize: 13.5, color: 'var(--muted)', lineHeight: 1.65 }}>Reset miners and local configuration for this organization. This action cannot be undone.</p>
                  {!deleteConfirm ? (
                    <button style={{ ...ghostButton, border: '1px solid rgba(248,113,113,0.22)', color: '#fecaca', background: 'rgba(248,113,113,0.08)' }} onClick={() => setDeleteConfirm(true)}>Reset All Data</button>
                  ) : (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 13, color: '#fca5a5' }}>Are you sure?</span>
                      <button style={{ ...ghostButton, border: '1px solid rgba(248,113,113,0.22)', color: '#fecaca', background: 'rgba(248,113,113,0.08)' }} onClick={deleteOrg}>Yes, reset everything</button>
                      <button style={ghostButton} onClick={() => setDeleteConfirm(false)}>Cancel</button>
                    </div>
                  )}
                </section>
              </>
            )}

            {tab === 'automation' && (
              <>
                <section style={appCardStyle(28, '24px')}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                    <RotateCcw style={{ width: 18, height: 18, color: 'var(--accent-blue)' }} />
                    <h2 style={{ margin: 0, fontSize: 22, color: 'var(--foreground)' }}>Auto recovery</h2>
                  </div>
                  <p style={{ margin: '0 0 18px', fontSize: 13.5, color: 'var(--muted)', lineHeight: 1.65 }}>Automatically attempt a restart when a miner stays offline for more than five minutes.</p>
                  <label style={{ display: 'inline-flex', alignItems: 'center', gap: 10, fontSize: 14, color: 'var(--foreground)' }}>
                    <input type="checkbox" checked={autoRebootEnabled} onChange={(event) => setAutoRebootEnabled(event.target.checked)} style={{ width: 16, height: 16, accentColor: '#6aa7ff' }} />
                    Enable auto-reboot on crash
                  </label>
                </section>
                <section style={appCardStyle(28, '24px')}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                    <PlaneTakeoff style={{ width: 18, height: 18, color: 'var(--accent-blue)' }} />
                    <h2 style={{ margin: 0, fontSize: 22, color: 'var(--foreground)' }}>Vacation mode</h2>
                  </div>
                  <p style={{ margin: '0 0 18px', fontSize: 13.5, color: 'var(--muted)', lineHeight: 1.65 }}>Pause recovery actions while you are away and make the fleet state explicit in the dashboard.</p>
                  <label style={{ display: 'inline-flex', alignItems: 'center', gap: 10, fontSize: 14, color: 'var(--foreground)' }}>
                    <input type="checkbox" checked={vacationModeEnabled} onChange={(event) => setVacationModeEnabled(event.target.checked)} style={{ width: 16, height: 16, accentColor: '#6aa7ff' }} />
                    Enable vacation mode
                  </label>
                </section>
                <div>
                  <button onClick={saveAutomation} disabled={savingAutomation} style={primaryButton}>{savingAutomation ? 'Saving...' : 'Save Automation'}</button>
                </div>
              </>
            )}

            {tab === 'wallets' && (
              <section style={appCardStyle(28, '24px')}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                  <Wallet style={{ width: 18, height: 18, color: 'var(--accent-strong)' }} />
                  <h2 style={{ margin: 0, fontSize: 22, color: 'var(--foreground)' }}>Payout wallets</h2>
                </div>
                <p style={{ margin: '0 0 18px', fontSize: 13.5, color: 'var(--muted)', lineHeight: 1.65 }}>Track multiple Bitcoin payout addresses directly from the dashboard and surface balances on the home screen.</p>
                <div style={{ display: 'flex', gap: 10, marginBottom: 18, flexWrap: 'wrap' }}>
                  <input value={walletAddress} onChange={(event) => setWalletAddress(event.target.value)} placeholder="bc1... or 1..." style={{ ...inputStyle, flex: 1, minWidth: 280 }} />
                  <button style={primaryButton} onClick={addWallet}><Plus style={{ width: 14, height: 14, display: 'inline', marginRight: 6, verticalAlign: 'text-bottom' }} />Add wallet</button>
                </div>
                <div style={{ display: 'grid', gap: 10 }}>
                  {wallets.length === 0 ? (
                    <div style={{ fontSize: 13.5, color: 'var(--muted-2)' }}>No wallet address tracked yet.</div>
                  ) : wallets.map((wallet) => (
                    <div key={wallet.address} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '14px 16px', borderRadius: 18, background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border-1)' }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 13.5, color: 'var(--foreground)', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{wallet.address}</div>
                        <div style={{ fontSize: 12.5, color: wallet.error ? 'var(--danger)' : 'var(--muted)' }}>{wallet.error || `${wallet.balanceBtc.toFixed(8)} BTC`}</div>
                      </div>
                      <button style={{ ...ghostButton, width: 42, padding: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => void removeWallet(wallet.address)}>
                        <Trash2 style={{ width: 14, height: 14 }} />
                      </button>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {tab === 'night-mode' && (
              <section style={appCardStyle(28, '24px')}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                  <Moon style={{ width: 18, height: 18, color: '#c4b5fd' }} />
                  <h2 style={{ margin: 0, fontSize: 22, color: 'var(--foreground)' }}>Night schedule</h2>
                </div>
                <p style={{ margin: '0 0 18px', fontSize: 13.5, color: 'var(--muted)', lineHeight: 1.65 }}>Reduce noise and power during quiet hours by switching miners to a lower operating profile.</p>
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 10, fontSize: 14, color: 'var(--foreground)', marginBottom: 20 }}>
                  <input type="checkbox" checked={nightSchedule.enabled} onChange={(event) => setNightSchedule({ ...nightSchedule, enabled: event.target.checked })} style={{ width: 16, height: 16, accentColor: '#c4b5fd' }} />
                  Enable night mode schedule
                </label>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 14, opacity: nightSchedule.enabled ? 1 : 0.45 }}>
                  <div>
                    <label style={{ display: 'block', fontSize: 12.5, color: 'var(--muted)', marginBottom: 8 }}>Start hour</label>
                    <select value={nightSchedule.startHour} disabled={!nightSchedule.enabled} onChange={(event) => setNightSchedule({ ...nightSchedule, startHour: parseInt(event.target.value) })} style={inputStyle}>
                      {Array.from({ length: 24 }, (_, index) => <option key={index} value={index}>{String(index).padStart(2, '0')}:00</option>)}
                    </select>
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: 12.5, color: 'var(--muted)', marginBottom: 8 }}>End hour</label>
                    <select value={nightSchedule.endHour} disabled={!nightSchedule.enabled} onChange={(event) => setNightSchedule({ ...nightSchedule, endHour: parseInt(event.target.value) })} style={inputStyle}>
                      {Array.from({ length: 24 }, (_, index) => <option key={index} value={index}>{String(index).padStart(2, '0')}:00</option>)}
                    </select>
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: 12.5, color: 'var(--muted)', marginBottom: 8 }}>Fan speed (%)</label>
                    <input type="number" min="0" max="100" disabled={!nightSchedule.enabled} value={nightSchedule.fanPercent} onChange={(event) => setNightSchedule({ ...nightSchedule, fanPercent: parseInt(event.target.value) || 0 })} style={inputStyle} />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: 12.5, color: 'var(--muted)', marginBottom: 8 }}>Work mode</label>
                    <select value={nightSchedule.workMode} disabled={!nightSchedule.enabled} onChange={(event) => setNightSchedule({ ...nightSchedule, workMode: event.target.value })} style={inputStyle}>
                      <option value="0">Low Power (Eco)</option>
                      <option value="1">Normal</option>
                      <option value="2">High Performance</option>
                    </select>
                  </div>
                </div>
                {nightSchedule.enabled && (
                  <p style={{ margin: '18px 0 0', fontSize: 13, color: 'var(--muted)', lineHeight: 1.65 }}>
                    Miners will switch to <strong style={{ color: '#ddd6fe' }}>{nightSchedule.workMode === '0' ? 'Low Power' : nightSchedule.workMode === '1' ? 'Normal' : 'High Performance'}</strong> mode with <strong style={{ color: '#ddd6fe' }}>{nightSchedule.fanPercent}%</strong> fan speed from <strong style={{ color: 'var(--foreground)' }}>{String(nightSchedule.startHour).padStart(2, '0')}:00</strong> to <strong style={{ color: 'var(--foreground)' }}>{String(nightSchedule.endHour).padStart(2, '0')}:00</strong>.
                  </p>
                )}
                <div style={{ marginTop: 20 }}>
                  <button onClick={saveNightSchedule} disabled={savingNight} style={primaryButton}>{savingNight ? 'Saving...' : 'Save Night Schedule'}</button>
                </div>
              </section>
            )}

            {tab === 'members' && (
              <>
                <section style={appCardStyle(28, '24px')}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                    <Users style={{ width: 18, height: 18, color: 'var(--accent-blue)' }} />
                    <h2 style={{ margin: 0, fontSize: 22, color: 'var(--foreground)' }}>Invite member</h2>
                  </div>
                  <p style={{ margin: '0 0 18px', fontSize: 13.5, color: 'var(--muted)', lineHeight: 1.65 }}>Send an invite by email and assign a role for team access.</p>
                  <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 140px auto', gap: 12, alignItems: 'end' }}>
                    <div>
                      <label style={{ display: 'block', fontSize: 12.5, color: 'var(--muted)', marginBottom: 8 }}>Email address</label>
                      <input value={inviteEmail} onChange={(event) => setInviteEmail(event.target.value)} placeholder="teammate@example.com" style={inputStyle} />
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: 12.5, color: 'var(--muted)', marginBottom: 8 }}>Role</label>
                      <select value={inviteRole} onChange={(event) => setInviteRole(event.target.value)} style={inputStyle}>
                        <option>Member</option>
                        <option>Admin</option>
                        <option>Owner</option>
                      </select>
                    </div>
                    <button style={primaryButton} onClick={() => { if (inviteEmail) { toast('success', `Invite sent to ${inviteEmail}`); setInviteEmail(''); } }}>Send Invite</button>
                  </div>
                </section>
                <section style={appCardStyle(28, '24px')}>
                  <div style={{ display: 'flex', gap: 8, marginBottom: 18 }}>
                    {(['active', 'pending'] as MembersTab[]).map((value) => (
                      <button key={value} onClick={() => setMembersTab(value)} style={{ height: 36, padding: '0 14px', borderRadius: 999, border: membersTab === value ? '1px solid rgba(247,147,26,0.22)' : '1px solid var(--border-1)', background: membersTab === value ? 'rgba(247,147,26,0.12)' : 'rgba(255,255,255,0.03)', color: membersTab === value ? 'var(--accent-strong)' : 'var(--muted)', cursor: 'pointer', fontSize: 12.5, fontWeight: 700 }}>{value === 'active' ? 'Active Members' : 'Pending Invitations'}</button>
                    ))}
                  </div>
                  {membersTab === 'active' && authUser && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 16px', borderRadius: 18, background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border-1)' }}>
                      <div style={{ width: 42, height: 42, borderRadius: 14, background: 'linear-gradient(135deg, rgba(247,147,26,0.98) 0%, rgba(255,175,81,0.84) 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#11131a', fontWeight: 800, flexShrink: 0 }}>
                        {authUser.name.charAt(0).toUpperCase()}
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--foreground)' }}>{authUser.name}</div>
                        <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>{authUser.email}</div>
                      </div>
                      <span style={{ height: 30, padding: '0 12px', borderRadius: 999, display: 'inline-flex', alignItems: 'center', background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border-1)', color: 'var(--foreground)', fontSize: 12.5, fontWeight: 700 }}>Owner</span>
                      <button style={{ ...ghostButton, width: 40, padding: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}><MoreVertical style={{ width: 15, height: 15 }} /></button>
                    </div>
                  )}
                  {membersTab === 'active' && !authUser && <p style={{ color: 'var(--muted-2)', fontSize: 13.5 }}>No members found. Log in to see members.</p>}
                  {membersTab === 'pending' && <p style={{ color: 'var(--muted-2)', fontSize: 13.5 }}>No pending invitations.</p>}
                </section>
              </>
            )}

            {tab === 'agent' && (
              <>
                <section style={appCardStyle(28, '24px')}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, gap: 12 }}>
                    <div>
                      <h2 style={{ margin: 0, fontSize: 22, color: 'var(--foreground)' }}>Agent status</h2>
                      <p style={{ margin: '8px 0 0', fontSize: 13.5, color: 'var(--muted)', lineHeight: 1.65 }}>Real-time heartbeat for your local mining agent.</p>
                    </div>
                    {agentData && (
                      <span style={{ height: 34, padding: '0 12px', borderRadius: 999, display: 'inline-flex', alignItems: 'center', background: agentData.online ? 'rgba(74,222,128,0.12)' : 'rgba(248,113,113,0.12)', border: agentData.online ? '1px solid rgba(74,222,128,0.18)' : '1px solid rgba(248,113,113,0.18)', color: agentData.online ? 'var(--success)' : 'var(--danger)', fontSize: 12.5, fontWeight: 700 }}>
                        {agentData.online ? 'Online' : 'Offline'}
                      </span>
                    )}
                  </div>
                  <div style={{ display: 'grid', gap: 10 }}>
                    {agentData ? [
                      ['Type', agentData.type],
                      ['Version', agentData.version],
                      ['Latest available', agentData.latestVersion || agentVersion || '—'],
                      ['Platform', agentData.platform || '—'],
                      ['Hostname', agentData.hostname],
                      ['Public IP', agentData.publicIp],
                      ['Local IP', agentData.localIp],
                      ['Last Online', agentData.lastSeen ? new Date(agentData.lastSeen).toLocaleString('fr-FR') : '—'],
                    ].map(([label, value]) => (
                      <div key={label} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '14px 16px', borderRadius: 18, background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border-1)' }}>
                        <span style={{ fontSize: 13, color: 'var(--muted)' }}>{label}</span>
                        <span style={{ fontSize: 13, color: 'var(--foreground)', fontWeight: 700 }}>{value || '—'}</span>
                      </div>
                    )) : <div style={{ fontSize: 13.5, color: 'var(--muted-2)' }}>No agent connected. Install and link the agent to see status here.</div>}
                    {agentData?.updateAvailable && (
                      <div style={{ padding: '14px 16px', borderRadius: 18, background: 'rgba(247,147,26,0.08)', border: '1px solid rgba(247,147,26,0.18)', color: 'var(--accent-strong)', fontSize: 13, fontWeight: 700 }}>
                        Update available: v{agentData.latestVersion || agentVersion}. Download the latest binary and run the Windows service update script.
                      </div>
                    )}
                  </div>
                </section>
                <section style={appCardStyle(28, '24px')}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                    <Download style={{ width: 18, height: 18, color: 'var(--accent-strong)' }} />
                    <h2 style={{ margin: 0, fontSize: 22, color: 'var(--foreground)' }}>Download agent</h2>
                  </div>
                  <p style={{ margin: '0 0 18px', fontSize: 13.5, color: 'var(--muted)', lineHeight: 1.65 }}>Only needed for CGMiner devices or multi-network discovery. AxeOS miners can already be scanned directly from the dashboard.</p>
                  {agentVersion && <p style={{ margin: '0 0 14px', fontSize: 12.5, color: 'var(--muted)' }}>Latest version: <strong style={{ color: 'var(--foreground)' }}>v{agentVersion}</strong></p>}
                  <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                    {[
                      ['win-x64', 'Windows (x64)'],
                      ['linux-x64', 'Linux (x64)'],
                      ['linux-arm64', 'Linux (ARM64)'],
                    ].map(([platformKey, label]) => {
                      const platform = agentPlatforms[platformKey];
                      const style = {
                        ...ghostButton,
                        textDecoration: 'none',
                        opacity: platform?.available === false ? 0.55 : 1,
                        cursor: platform?.available === false ? 'default' : 'pointer',
                      } as React.CSSProperties;

                      if (!platform?.available) {
                        return <span key={platformKey} style={style}>{label}</span>;
                      }

                      return <a key={platformKey} href={platform.downloadUrl} style={style}>{label}</a>;
                    })}
                  </div>
                  <p style={{ margin: '14px 0 0', fontSize: 12.5, color: 'var(--muted-2)', lineHeight: 1.6 }}>For installed Windows services, run <strong style={{ color: 'var(--foreground)' }}>service/update-service.ps1</strong> after publishing a new agent build on the server.</p>
                </section>
              </>
            )}

            {tab === 'preferences' && (
              <>
                <section style={appCardStyle(28, '24px')}>
                  <h2 style={{ margin: 0, fontSize: 22, color: 'var(--foreground)', marginBottom: 20 }}>Display Preferences</h2>
                  <div style={{ display: 'grid', gap: 16 }}>
                    <div style={{ padding: '16px 18px', borderRadius: 16, background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border-1)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--foreground)', marginBottom: 4 }}>Profitability Details (€)</div>
                          <div style={{ fontSize: 13, color: 'var(--muted)' }}>Display estimated daily / monthly earnings on overview. Off by default for solo mining focus.</div>
                        </div>
                        <div style={{ width: 40, height: 24, borderRadius: 12, background: 'rgba(255,255,255,0.08)', border: '1px solid var(--border-1)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, color: 'var(--muted)' }}>
                          (localStorage)
                        </div>
                      </div>
                    </div>
                    <div style={{ padding: '16px 18px', borderRadius: 16, background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border-1)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--foreground)', marginBottom: 4 }}>Browser Notifications</div>
                          <div style={{ fontSize: 13, color: 'var(--muted)' }}>Receive alerts about new share records, miner status changes, and important events.</div>
                        </div>
                        <button style={{ height: 36, padding: '0 14px', borderRadius: 12, background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border-1)', color: 'var(--muted)', fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}>
                          (Manage in Dashboard)
                        </button>
                      </div>
                    </div>
                  </div>
                </section>
              </>
            )}
          </div>
        </section>
      </div>
    </>
  );
}
