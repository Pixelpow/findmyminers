import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import { MoreVertical, Download, RotateCcw, PlaneTakeoff, Wallet, Plus, Trash2, Settings2, Users, Bot, ShieldAlert, Sliders, Gauge } from 'lucide-react';
import Link from 'next/link';
import { useToast } from '@/components/ToastProvider';
import { appCardStyle } from '@/lib/styles';

type SettingsTab = 'general' | 'members' | 'agent' | 'automation' | 'wallets' | 'preferences';
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
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [savingGeneral, setSavingGeneral] = useState(false);
  const [savingAutomation, setSavingAutomation] = useState(false);
  const [walletAddress, setWalletAddress] = useState('');
  const [wallets, setWallets] = useState<Array<{ address: string; balanceBtc: number; error?: string | null }>>([]);
  const [autoRebootEnabled, setAutoRebootEnabled] = useState(false);
  const [vacationModeEnabled, setVacationModeEnabled] = useState(false);

  // Notifications push navigateur (records, pannes, événements importants)
  const [pushSupported, setPushSupported] = useState(false);
  const [pushEnabled, setPushEnabled] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
    setPushSupported(supported);
    if (!supported) return;
    (async () => {
      try {
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.getSubscription();
        setPushEnabled(!!sub);
      } catch { /* ignore */ }
    })();
  }, []);

  const base64ToUint8Array = (value: string) => {
    const padding = '='.repeat((4 - value.length % 4) % 4);
    const base64 = (value + padding).replace(/-/g, '+').replace(/_/g, '/');
    const raw = window.atob(base64);
    return Uint8Array.from([...raw].map((char) => char.charCodeAt(0)));
  };

  const togglePush = async () => {
    if (!pushSupported || pushBusy) return;
    setPushBusy(true);
    try {
      const reg = await navigator.serviceWorker.ready;
      const existing = await reg.pushManager.getSubscription();
      if (existing) {
        await fetch('/api/push/subscription', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoint: existing.endpoint }),
        });
        await existing.unsubscribe();
        setPushEnabled(false);
        toast('success', 'Notifications désactivées');
        return;
      }
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        toast('warning', 'Permission refusée par le navigateur');
        return;
      }
      const keyRes = await fetch('/api/push/public-key');
      if (!keyRes.ok) throw new Error('Clé publique indisponible');
      const { publicKey } = await keyRes.json();
      const subscription = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: base64ToUint8Array(publicKey),
      });
      await fetch('/api/push/subscription', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subscription }),
      });
      setPushEnabled(true);
      toast('success', 'Notifications activées sur cet appareil');
    } catch (error) {
      toast('error', error instanceof Error ? error.message : 'Activation échouée');
    } finally {
      setPushBusy(false);
    }
  };

  useEffect(() => {
    if (!router.isReady) return;
    const current = router.query.tab as string;
    if (current && ['general', 'members', 'agent', 'automation', 'wallets', 'preferences'].includes(current)) {
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
    { id: 'general', label: 'Général', icon: Settings2 },
    { id: 'preferences', label: 'Préférences', icon: Sliders },
    { id: 'automation', label: 'Automatisation', icon: RotateCcw },
    { id: 'wallets', label: 'Wallets', icon: Wallet },
    { id: 'members', label: 'Membres', icon: Users },
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
                  <h2 style={{ margin: '0 0 8px', fontSize: 22, color: 'var(--foreground)' }}>Identité de l’espace</h2>
                  <p style={{ margin: '0 0 18px', fontSize: 13.5, color: 'var(--muted)', lineHeight: 1.65 }}>Un nom propre et reconnaissable, repris sur le dashboard, les alertes et les pages agent.</p>
                  <label style={{ display: 'block', fontSize: 12.5, color: 'var(--muted)', marginBottom: 8 }}>Nom de la ferme</label>
                  <input value={orgName} onChange={(event) => setOrgName(event.target.value)} style={{ ...inputStyle, maxWidth: 440 }} />
                  <div style={{ marginTop: 18 }}>
                    <button onClick={saveGeneral} disabled={savingGeneral} style={primaryButton}>{savingGeneral ? 'Enregistrement...' : 'Enregistrer'}</button>
                  </div>
                </section>

                <section style={appCardStyle(28, '24px')}>
                  <div style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--muted-2)', marginBottom: 8 }}>Deployment</div>
                  <h2 style={{ margin: '0 0 8px', fontSize: 22, color: 'var(--foreground)' }}>Version de l’application</h2>
                  <p style={{ margin: '0 0 18px', fontSize: 13.5, color: 'var(--muted)', lineHeight: 1.65 }}>Version du dashboard actuellement déployée. Les mises à jour sont appliquées côté serveur et récupérées automatiquement.</p>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '14px 16px', borderRadius: 18, background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border-1)' }}>
                    <span style={{ fontSize: 13, color: 'var(--muted)' }}>Build du dashboard</span>
                    <span style={{ fontSize: 13, color: 'var(--foreground)', fontWeight: 700 }}>{appVersion ? `v${appVersion}` : '—'}</span>
                  </div>
                </section>

                <section style={{ ...appCardStyle(28, '24px'), border: '1px solid rgba(248,113,113,0.18)', background: 'linear-gradient(180deg, rgba(53,18,21,0.55) 0%, rgba(21,13,16,0.92) 100%)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                    <ShieldAlert style={{ width: 16, height: 16, color: '#fca5a5' }} />
                    <h2 style={{ margin: 0, fontSize: 20, color: 'var(--foreground)' }}>Zone dangereuse</h2>
                  </div>
                  <p style={{ margin: '0 0 18px', fontSize: 13.5, color: 'var(--muted)', lineHeight: 1.65 }}>Réinitialise les mineurs et la configuration locale de cette organisation. Action irréversible.</p>
                  {!deleteConfirm ? (
                    <button style={{ ...ghostButton, border: '1px solid rgba(248,113,113,0.22)', color: '#fecaca', background: 'rgba(248,113,113,0.08)' }} onClick={() => setDeleteConfirm(true)}>Tout réinitialiser</button>
                  ) : (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 13, color: '#fca5a5' }}>Confirmer ?</span>
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
                    <h2 style={{ margin: 0, fontSize: 22, color: 'var(--foreground)' }}>Redémarrage automatique</h2>
                  </div>
                  <p style={{ margin: '0 0 18px', fontSize: 13.5, color: 'var(--muted)', lineHeight: 1.65 }}>Tente automatiquement un redémarrage quand un mineur reste hors ligne plus de cinq minutes.</p>
                  <label style={{ display: 'inline-flex', alignItems: 'center', gap: 10, fontSize: 14, color: 'var(--foreground)' }}>
                    <input type="checkbox" checked={autoRebootEnabled} onChange={(event) => setAutoRebootEnabled(event.target.checked)} style={{ width: 16, height: 16, accentColor: '#6aa7ff' }} />
                    Activer le redémarrage auto en cas de panne
                  </label>
                </section>
                <section style={appCardStyle(28, '24px')}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                    <PlaneTakeoff style={{ width: 18, height: 18, color: 'var(--accent-blue)' }} />
                    <h2 style={{ margin: 0, fontSize: 22, color: 'var(--foreground)' }}>Mode vacances</h2>
                  </div>
                  <p style={{ margin: '0 0 18px', fontSize: 13.5, color: 'var(--muted)', lineHeight: 1.65 }}>Suspend les actions de récupération pendant ton absence et l’affiche clairement sur le dashboard.</p>
                  <label style={{ display: 'inline-flex', alignItems: 'center', gap: 10, fontSize: 14, color: 'var(--foreground)' }}>
                    <input type="checkbox" checked={vacationModeEnabled} onChange={(event) => setVacationModeEnabled(event.target.checked)} style={{ width: 16, height: 16, accentColor: '#6aa7ff' }} />
                    Activer le mode vacances
                  </label>
                </section>
                <div>
                  <button onClick={saveAutomation} disabled={savingAutomation} style={primaryButton}>{savingAutomation ? 'Enregistrement...' : 'Enregistrer'}</button>
                </div>
                <Link href="/overclock" style={{ textDecoration: 'none' }}>
                  <section style={{ ...appCardStyle(28, '20px'), display: 'flex', alignItems: 'center', gap: 14, cursor: 'pointer' }}>
                    <div style={{ flexShrink: 0, width: 42, height: 42, borderRadius: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(247,147,26,0.12)', border: '1px solid rgba(247,147,26,0.22)' }}>
                      <Gauge style={{ width: 20, height: 20, color: 'var(--accent-strong)' }} />
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <h3 style={{ margin: '0 0 4px', fontSize: 16, color: 'var(--foreground)' }}>Mode nuit &amp; planification</h3>
                      <p style={{ margin: 0, fontSize: 13, color: 'var(--muted)', lineHeight: 1.6 }}>La réduction nocturne fait désormais partie de l’onglet Overclock : créneaux horaires, undervolt et profils par puce au même endroit.</p>
                    </div>
                  </section>
                </Link>
              </>
            )}

            {tab === 'wallets' && (
              <section style={appCardStyle(28, '24px')}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                  <Wallet style={{ width: 18, height: 18, color: 'var(--accent-strong)' }} />
                  <h2 style={{ margin: 0, fontSize: 22, color: 'var(--foreground)' }}>Wallets de paiement</h2>
                </div>
                <p style={{ margin: '0 0 18px', fontSize: 13.5, color: 'var(--muted)', lineHeight: 1.65 }}>Suis plusieurs adresses Bitcoin directement depuis le dashboard, soldes affichés sur l’accueil.</p>
                <div style={{ display: 'flex', gap: 10, marginBottom: 18, flexWrap: 'wrap' }}>
                  <input value={walletAddress} onChange={(event) => setWalletAddress(event.target.value)} placeholder="bc1... or 1..." style={{ ...inputStyle, flex: 1, minWidth: 280 }} />
                  <button style={primaryButton} onClick={addWallet}><Plus style={{ width: 14, height: 14, display: 'inline', marginRight: 6, verticalAlign: 'text-bottom' }} />Ajouter</button>
                </div>
                <div style={{ display: 'grid', gap: 10 }}>
                  {wallets.length === 0 ? (
                    <div style={{ fontSize: 13.5, color: 'var(--muted-2)' }}>Aucune adresse suivie pour l’instant.</div>
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

            {tab === 'members' && (
              <>
                <section style={appCardStyle(28, '24px')}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                    <Users style={{ width: 18, height: 18, color: 'var(--accent-blue)' }} />
                    <h2 style={{ margin: 0, fontSize: 22, color: 'var(--foreground)' }}>Inviter un membre</h2>
                  </div>
                  <p style={{ margin: '0 0 18px', fontSize: 13.5, color: 'var(--muted)', lineHeight: 1.65 }}>Envoie une invitation par e-mail et attribue un rôle d’accès.</p>
                  <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 140px auto', gap: 12, alignItems: 'end' }}>
                    <div>
                      <label style={{ display: 'block', fontSize: 12.5, color: 'var(--muted)', marginBottom: 8 }}>Adresse e-mail</label>
                      <input value={inviteEmail} onChange={(event) => setInviteEmail(event.target.value)} placeholder="teammate@example.com" style={inputStyle} />
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: 12.5, color: 'var(--muted)', marginBottom: 8 }}>Role</label>
                      <select value={inviteRole} onChange={(event) => setInviteRole(event.target.value)} style={inputStyle}>
                        <option>Membre</option>
                        <option>Admin</option>
                        <option>Owner</option>
                      </select>
                    </div>
                    <button style={primaryButton} onClick={() => { if (inviteEmail) { toast('success', `Invitation envoyée à ${inviteEmail}`); setInviteEmail(''); } }}>Envoyer l’invitation</button>
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
                  {membersTab === 'active' && !authUser && <p style={{ color: 'var(--muted-2)', fontSize: 13.5 }}>Aucun membre trouvé. Connecte-toi pour voir les membres.</p>}
                  {membersTab === 'pending' && <p style={{ color: 'var(--muted-2)', fontSize: 13.5 }}>Aucune invitation en attente.</p>}
                </section>
              </>
            )}

            {tab === 'agent' && (
              <>
                <section style={appCardStyle(28, '24px')}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, gap: 12 }}>
                    <div>
                      <h2 style={{ margin: 0, fontSize: 22, color: 'var(--foreground)' }}>Statut de l’agent</h2>
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
                      ['Vu en ligne', agentData.lastSeen ? new Date(agentData.lastSeen).toLocaleString('fr-FR') : '—'],
                    ].map(([label, value]) => (
                      <div key={label} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '14px 16px', borderRadius: 18, background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border-1)' }}>
                        <span style={{ fontSize: 13, color: 'var(--muted)' }}>{label}</span>
                        <span style={{ fontSize: 13, color: 'var(--foreground)', fontWeight: 700 }}>{value || '—'}</span>
                      </div>
                    )) : <div style={{ fontSize: 13.5, color: 'var(--muted-2)' }}>Aucun agent connecté. Installe et relie l’agent pour voir son statut ici.</div>}
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
                    <h2 style={{ margin: 0, fontSize: 22, color: 'var(--foreground)' }}>Télécharger l’agent</h2>
                  </div>
                  <p style={{ margin: '0 0 18px', fontSize: 13.5, color: 'var(--muted)', lineHeight: 1.65 }}>Nécessaire uniquement pour les appareils CGMiner ou la découverte multi-réseaux. Les mineurs AxeOS sont scannés directement depuis le dashboard.</p>
                  {agentVersion && <p style={{ margin: '0 0 14px', fontSize: 12.5, color: 'var(--muted)' }}>Dernière version : <strong style={{ color: 'var(--foreground)' }}>v{agentVersion}</strong></p>}
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
                  <p style={{ margin: '14px 0 0', fontSize: 12.5, color: 'var(--muted-2)', lineHeight: 1.6 }}>Pour les services Windows installés, lance <strong style={{ color: 'var(--foreground)' }}>service/update-service.ps1</strong> après la publication d’un nouveau build de l’agent sur le serveur.</p>
                </section>
              </>
            )}

            {tab === 'preferences' && (
              <>
                <section style={appCardStyle(28, '24px')}>
                  <h2 style={{ margin: 0, fontSize: 22, color: 'var(--foreground)', marginBottom: 20 }}>Notifications</h2>
                  <div style={{ display: 'grid', gap: 16 }}>
                    <div style={{ padding: '16px 18px', borderRadius: 16, background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border-1)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--foreground)', marginBottom: 4 }}>Notifications navigateur</div>
                          <div style={{ fontSize: 13, color: 'var(--muted)' }}>
                            Reçois une notification pour les nouveaux records de share, les mineurs qui tombent et les événements importants — même quand l&apos;onglet est fermé.
                          </div>
                          {!pushSupported && (
                            <div style={{ fontSize: 12, color: 'var(--warning)', marginTop: 6 }}>
                              Non supporté par ce navigateur (HTTPS ou localhost requis).
                            </div>
                          )}
                        </div>
                        <button
                          onClick={() => void togglePush()}
                          disabled={!pushSupported || pushBusy}
                          style={{
                            height: 36,
                            padding: '0 16px',
                            borderRadius: 12,
                            border: pushEnabled ? '1px solid rgba(74,222,128,0.3)' : '1px solid rgba(247,147,26,0.3)',
                            background: pushEnabled ? 'rgba(74,222,128,0.12)' : 'rgba(247,147,26,0.12)',
                            color: pushEnabled ? 'var(--success)' : 'var(--accent-strong)',
                            fontSize: 12.5,
                            fontWeight: 700,
                            cursor: pushSupported && !pushBusy ? 'pointer' : 'not-allowed',
                            opacity: pushSupported ? 1 : 0.5,
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {pushBusy ? '...' : pushEnabled ? '✓ Activées — désactiver' : 'Activer'}
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
