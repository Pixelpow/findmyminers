import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import { Download, RotateCcw, PlaneTakeoff, Wallet, Plus, Trash2, Settings2, Bot, ShieldAlert, Sliders, Gauge } from 'lucide-react';
import Link from 'next/link';
import { useToast } from '@/components/ToastProvider';
import { appCardStyle } from '@/lib/styles';
import { useLang } from '@/lib/i18n';

type SettingsTab = 'general' | 'agent' | 'automation' | 'wallets' | 'preferences';
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
  const { t, lang, setLang } = useLang();
  const [tab, setTab] = useState<SettingsTab>('general');
  const [orgName, setOrgName] = useState('MiningFarm');
  const [, setSavedOrgName] = useState('MiningFarm');
  const [agentData, setAgentData] = useState<AgentData | null>(null);
  const [agentVersion, setAgentVersion] = useState<string>('');
  const [agentPlatforms, setAgentPlatforms] = useState<Record<string, AgentPlatform>>({});
  const [appVersion, setAppVersion] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [savingGeneral, setSavingGeneral] = useState(false);
  const [savingAutomation, setSavingAutomation] = useState(false);
  const [walletAddress, setWalletAddress] = useState('');
  const [wallets, setWallets] = useState<Array<{ address: string; balanceBtc: number; error?: string | null }>>([]);
  const [autoRebootEnabled, setAutoRebootEnabled] = useState(false);
  const [vacationModeEnabled, setVacationModeEnabled] = useState(false);
  const [showProfitability, setShowProfitability] = useState(false);
  const [savingProfit, setSavingProfit] = useState(false);

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
        toast('success', t('Notifications désactivées', 'Notifications disabled'));
        return;
      }
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        toast('warning', t('Permission refusée par le navigateur', 'Permission denied by the browser'));
        return;
      }
      const keyRes = await fetch('/api/push/public-key');
      if (!keyRes.ok) throw new Error(t('Clé publique indisponible', 'Public key unavailable'));
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
      toast('success', t('Notifications activées sur cet appareil', 'Notifications enabled on this device'));
    } catch (error) {
      toast('error', error instanceof Error ? error.message : t('Activation échouée', 'Activation failed'));
    } finally {
      setPushBusy(false);
    }
  };

  useEffect(() => {
    if (!router.isReady) return;
    const current = router.query.tab as string;
    if (current && ['general', 'agent', 'automation', 'wallets', 'preferences'].includes(current)) {
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
        setShowProfitability(!!config.ui?.showProfitability);
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
    finally { setSavingGeneral(false); toast('success', t('Réglages enregistrés', 'Settings saved')); }
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
    finally { setSavingAutomation(false); toast('success', t('Réglages d’automatisation enregistrés', 'Automation settings saved')); }
  };

  const toggleProfitability = async () => {
    const next = !showProfitability;
    setShowProfitability(next);
    setSavingProfit(true);
    try {
      await fetch('/api/miner/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ui: { showProfitability: next } }),
      });
      toast('success', next ? t('Estimations de rentabilité affichées', 'Profitability estimates shown') : t('Estimations de rentabilité masquées', 'Profitability estimates hidden'));
    } catch {
      setShowProfitability(!next);
      toast('error', t('Échec de l’enregistrement', 'Save failed'));
    } finally {
      setSavingProfit(false);
    }
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
    { id: 'general', label: t('Général', 'General'), icon: Settings2 },
    { id: 'preferences', label: t('Préférences', 'Preferences'), icon: Sliders },
    { id: 'automation', label: t('Automatisation', 'Automation'), icon: RotateCcw },
    { id: 'wallets', label: t('Wallets', 'Wallets'), icon: Wallet },
    { id: 'agent', label: t('Agent', 'Agent'), icon: Bot },
  ];

  return (
    <>
      <Head><title>{t('Paramètres', 'Settings')} · FindMyMiners</title></Head>
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
                  <div style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--muted-2)', marginBottom: 8 }}>{t('Organisation', 'Organization')}</div>
                  <h2 style={{ margin: '0 0 8px', fontSize: 22, color: 'var(--foreground)' }}>{t('Identité de l’espace', 'Workspace identity')}</h2>
                  <p style={{ margin: '0 0 18px', fontSize: 13.5, color: 'var(--muted)', lineHeight: 1.65 }}>{t('Un nom propre et reconnaissable, repris sur le dashboard, les alertes et les pages agent.', 'A clean, recognizable name, reused across the dashboard, alerts and agent pages.')}</p>
                  <label style={{ display: 'block', fontSize: 12.5, color: 'var(--muted)', marginBottom: 8 }}>{t('Nom de la ferme', 'Farm name')}</label>
                  <input value={orgName} onChange={(event) => setOrgName(event.target.value)} style={{ ...inputStyle, maxWidth: 440 }} />
                  <div style={{ marginTop: 18 }}>
                    <button onClick={saveGeneral} disabled={savingGeneral} style={primaryButton}>{savingGeneral ? t('Enregistrement...', 'Saving...') : t('Enregistrer', 'Save')}</button>
                  </div>
                </section>

                <section style={appCardStyle(28, '24px')}>
                  <div style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--muted-2)', marginBottom: 8 }}>{t('Déploiement', 'Deployment')}</div>
                  <h2 style={{ margin: '0 0 8px', fontSize: 22, color: 'var(--foreground)' }}>{t('Version de l’application', 'Application version')}</h2>
                  <p style={{ margin: '0 0 18px', fontSize: 13.5, color: 'var(--muted)', lineHeight: 1.65 }}>{t('Version du dashboard actuellement déployée. Les mises à jour sont appliquées côté serveur et récupérées automatiquement.', 'The dashboard version currently deployed. Updates are applied server-side and fetched automatically.')}</p>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '14px 16px', borderRadius: 18, background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border-1)' }}>
                    <span style={{ fontSize: 13, color: 'var(--muted)' }}>{t('Build du dashboard', 'Dashboard build')}</span>
                    <span style={{ fontSize: 13, color: 'var(--foreground)', fontWeight: 700 }}>{appVersion ? `v${appVersion}` : '—'}</span>
                  </div>
                </section>

                <section style={{ ...appCardStyle(28, '24px'), border: '1px solid rgba(248,113,113,0.18)', background: 'linear-gradient(180deg, rgba(53,18,21,0.55) 0%, rgba(21,13,16,0.92) 100%)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                    <ShieldAlert style={{ width: 16, height: 16, color: '#fca5a5' }} />
                    <h2 style={{ margin: 0, fontSize: 20, color: 'var(--foreground)' }}>{t('Zone dangereuse', 'Danger zone')}</h2>
                  </div>
                  <p style={{ margin: '0 0 18px', fontSize: 13.5, color: 'var(--muted)', lineHeight: 1.65 }}>{t('Réinitialise les mineurs et la configuration locale de cette organisation. Action irréversible.', 'Resets the miners and local configuration of this organization. This cannot be undone.')}</p>
                  {!deleteConfirm ? (
                    <button style={{ ...ghostButton, border: '1px solid rgba(248,113,113,0.22)', color: '#fecaca', background: 'rgba(248,113,113,0.08)' }} onClick={() => setDeleteConfirm(true)}>{t('Tout réinitialiser', 'Reset everything')}</button>
                  ) : (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 13, color: '#fca5a5' }}>{t('Confirmer ?', 'Confirm?')}</span>
                      <button style={{ ...ghostButton, border: '1px solid rgba(248,113,113,0.22)', color: '#fecaca', background: 'rgba(248,113,113,0.08)' }} onClick={deleteOrg}>{t('Oui, tout réinitialiser', 'Yes, reset everything')}</button>
                      <button style={ghostButton} onClick={() => setDeleteConfirm(false)}>{t('Annuler', 'Cancel')}</button>
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
                    <h2 style={{ margin: 0, fontSize: 22, color: 'var(--foreground)' }}>{t('Redémarrage automatique', 'Automatic reboot')}</h2>
                  </div>
                  <p style={{ margin: '0 0 18px', fontSize: 13.5, color: 'var(--muted)', lineHeight: 1.65 }}>{t('Tente automatiquement un redémarrage quand un mineur reste hors ligne plus de cinq minutes.', 'Automatically attempts a reboot when a miner stays offline for more than five minutes.')}</p>
                  <label style={{ display: 'inline-flex', alignItems: 'center', gap: 10, fontSize: 14, color: 'var(--foreground)' }}>
                    <input type="checkbox" checked={autoRebootEnabled} onChange={(event) => setAutoRebootEnabled(event.target.checked)} style={{ width: 16, height: 16, accentColor: '#6aa7ff' }} />
                    {t('Activer le redémarrage auto en cas de panne', 'Enable auto-reboot on failure')}
                  </label>
                </section>
                <section style={appCardStyle(28, '24px')}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                    <PlaneTakeoff style={{ width: 18, height: 18, color: 'var(--accent-blue)' }} />
                    <h2 style={{ margin: 0, fontSize: 22, color: 'var(--foreground)' }}>{t('Mode vacances', 'Vacation mode')}</h2>
                  </div>
                  <p style={{ margin: '0 0 18px', fontSize: 13.5, color: 'var(--muted)', lineHeight: 1.65 }}>{t('Suspend les actions de récupération pendant ton absence et l’affiche clairement sur le dashboard.', 'Pauses recovery actions while you’re away and shows it clearly on the dashboard.')}</p>
                  <label style={{ display: 'inline-flex', alignItems: 'center', gap: 10, fontSize: 14, color: 'var(--foreground)' }}>
                    <input type="checkbox" checked={vacationModeEnabled} onChange={(event) => setVacationModeEnabled(event.target.checked)} style={{ width: 16, height: 16, accentColor: '#6aa7ff' }} />
                    {t('Activer le mode vacances', 'Enable vacation mode')}
                  </label>
                </section>
                <div>
                  <button onClick={saveAutomation} disabled={savingAutomation} style={primaryButton}>{savingAutomation ? t('Enregistrement...', 'Saving...') : t('Enregistrer', 'Save')}</button>
                </div>
                <Link href="/overclock" style={{ textDecoration: 'none' }}>
                  <section style={{ ...appCardStyle(28, '20px'), display: 'flex', alignItems: 'center', gap: 14, cursor: 'pointer' }}>
                    <div style={{ flexShrink: 0, width: 42, height: 42, borderRadius: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(247,147,26,0.12)', border: '1px solid rgba(247,147,26,0.22)' }}>
                      <Gauge style={{ width: 20, height: 20, color: 'var(--accent-strong)' }} />
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <h3 style={{ margin: '0 0 4px', fontSize: 16, color: 'var(--foreground)' }}>{t('Mode nuit & planification', 'Night mode & scheduling')}</h3>
                      <p style={{ margin: 0, fontSize: 13, color: 'var(--muted)', lineHeight: 1.6 }}>{t('La réduction nocturne fait désormais partie de l’onglet Overclock : créneaux horaires, undervolt et profils par puce au même endroit.', 'Night throttling is now part of the Overclock tab: time slots, undervolt and per-chip profiles in one place.')}</p>
                    </div>
                  </section>
                </Link>
              </>
            )}

            {tab === 'wallets' && (
              <section style={appCardStyle(28, '24px')}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                  <Wallet style={{ width: 18, height: 18, color: 'var(--accent-strong)' }} />
                  <h2 style={{ margin: 0, fontSize: 22, color: 'var(--foreground)' }}>{t('Wallets de paiement', 'Payout wallets')}</h2>
                </div>
                <p style={{ margin: '0 0 18px', fontSize: 13.5, color: 'var(--muted)', lineHeight: 1.65 }}>{t('Suis plusieurs adresses Bitcoin directement depuis le dashboard, soldes affichés sur l’accueil.', 'Track multiple Bitcoin addresses straight from the dashboard, balances shown on the home page.')}</p>
                <div style={{ display: 'flex', gap: 10, marginBottom: 18, flexWrap: 'wrap' }}>
                  <input value={walletAddress} onChange={(event) => setWalletAddress(event.target.value)} placeholder="bc1... or 1..." style={{ ...inputStyle, flex: 1, minWidth: 280 }} />
                  <button style={primaryButton} onClick={addWallet}><Plus style={{ width: 14, height: 14, display: 'inline', marginRight: 6, verticalAlign: 'text-bottom' }} />{t('Ajouter', 'Add')}</button>
                </div>
                <div style={{ display: 'grid', gap: 10 }}>
                  {wallets.length === 0 ? (
                    <div style={{ fontSize: 13.5, color: 'var(--muted-2)' }}>{t('Aucune adresse suivie pour l’instant.', 'No address tracked yet.')}</div>
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

            {tab === 'agent' && (
              <>
                <section style={appCardStyle(28, '24px')}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, gap: 12 }}>
                    <div>
                      <h2 style={{ margin: 0, fontSize: 22, color: 'var(--foreground)' }}>{t('Statut de l’agent', 'Agent status')}</h2>
                      <p style={{ margin: '8px 0 0', fontSize: 13.5, color: 'var(--muted)', lineHeight: 1.65 }}>{t('Heartbeat en temps réel de ton agent de minage local.', 'Real-time heartbeat for your local mining agent.')}</p>
                    </div>
                    {agentData && (
                      <span style={{ height: 34, padding: '0 12px', borderRadius: 999, display: 'inline-flex', alignItems: 'center', background: agentData.online ? 'rgba(74,222,128,0.12)' : 'rgba(248,113,113,0.12)', border: agentData.online ? '1px solid rgba(74,222,128,0.18)' : '1px solid rgba(248,113,113,0.18)', color: agentData.online ? 'var(--success)' : 'var(--danger)', fontSize: 12.5, fontWeight: 700 }}>
                        {agentData.online ? t('En ligne', 'Online') : t('Hors ligne', 'Offline')}
                      </span>
                    )}
                  </div>
                  <div style={{ display: 'grid', gap: 10 }}>
                    {agentData ? [
                      ['Type', agentData.type],
                      ['Version', agentData.version],
                      [t('Dernière dispo', 'Latest available'), agentData.latestVersion || agentVersion || '—'],
                      [t('Plateforme', 'Platform'), agentData.platform || '—'],
                      [t('Nom d’hôte', 'Hostname'), agentData.hostname],
                      [t('IP publique', 'Public IP'), agentData.publicIp],
                      [t('IP locale', 'Local IP'), agentData.localIp],
                      [t('Vu en ligne', 'Last seen'), agentData.lastSeen ? new Date(agentData.lastSeen).toLocaleString(lang === 'fr' ? 'fr-FR' : 'en-US') : '—'],
                    ].map(([label, value]) => (
                      <div key={label} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '14px 16px', borderRadius: 18, background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border-1)' }}>
                        <span style={{ fontSize: 13, color: 'var(--muted)' }}>{label}</span>
                        <span style={{ fontSize: 13, color: 'var(--foreground)', fontWeight: 700 }}>{value || '—'}</span>
                      </div>
                    )) : <div style={{ fontSize: 13.5, color: 'var(--muted-2)' }}>{t('Aucun agent connecté. Installe et relie l’agent pour voir son statut ici.', 'No agent connected. Install and link the agent to see its status here.')}</div>}
                    {agentData?.updateAvailable && (
                      <div style={{ padding: '14px 16px', borderRadius: 18, background: 'rgba(247,147,26,0.08)', border: '1px solid rgba(247,147,26,0.18)', color: 'var(--accent-strong)', fontSize: 13, fontWeight: 700 }}>
                        {t(`Mise à jour disponible : v${agentData.latestVersion || agentVersion}. Télécharge le dernier binaire et lance le script de mise à jour du service Windows.`, `Update available: v${agentData.latestVersion || agentVersion}. Download the latest binary and run the Windows service update script.`)}
                      </div>
                    )}
                  </div>
                </section>
                <section style={appCardStyle(28, '24px')}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                    <Download style={{ width: 18, height: 18, color: 'var(--accent-strong)' }} />
                    <h2 style={{ margin: 0, fontSize: 22, color: 'var(--foreground)' }}>{t('Télécharger l’agent', 'Download the agent')}</h2>
                  </div>
                  <p style={{ margin: '0 0 18px', fontSize: 13.5, color: 'var(--muted)', lineHeight: 1.65 }}>{t('Nécessaire uniquement pour les appareils CGMiner ou la découverte multi-réseaux. Les mineurs AxeOS sont scannés directement depuis le dashboard.', 'Only needed for CGMiner devices or multi-network discovery. AxeOS miners are scanned directly from the dashboard.')}</p>
                  {agentVersion && <p style={{ margin: '0 0 14px', fontSize: 12.5, color: 'var(--muted)' }}>{t('Dernière version', 'Latest version')} : <strong style={{ color: 'var(--foreground)' }}>v{agentVersion}</strong></p>}
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
                  <p style={{ margin: '14px 0 0', fontSize: 12.5, color: 'var(--muted-2)', lineHeight: 1.6 }}>{t('Pour les services Windows installés, lance', 'For installed Windows services, run')} <strong style={{ color: 'var(--foreground)' }}>service/update-service.ps1</strong> {t('après la publication d’un nouveau build de l’agent sur le serveur.', 'after publishing a new agent build to the server.')}</p>
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
                          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--foreground)', marginBottom: 4 }}>{t('Notifications navigateur', 'Browser notifications')}</div>
                          <div style={{ fontSize: 13, color: 'var(--muted)' }}>
                            {t('Reçois une notification pour les nouveaux records de share, les mineurs qui tombent et les événements importants — même quand l’onglet est fermé.', 'Get notified about new share records, miners going down and important events — even when the tab is closed.')}
                          </div>
                          {!pushSupported && (
                            <div style={{ fontSize: 12, color: 'var(--warning)', marginTop: 6 }}>
                              {t('Non supporté par ce navigateur (HTTPS ou localhost requis).', 'Not supported by this browser (HTTPS or localhost required).')}
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
                          {pushBusy ? '...' : pushEnabled ? t('✓ Activées — désactiver', '✓ Enabled — disable') : t('Activer', 'Enable')}
                        </button>
                      </div>
                    </div>
                  </div>
                </section>
                <section style={appCardStyle(28, '24px')}>
                  <h2 style={{ margin: 0, fontSize: 22, color: 'var(--foreground)', marginBottom: 20 }}>{t('Affichage', 'Display')}</h2>
                  <div style={{ display: 'grid', gap: 14 }}>
                    {/* Langue */}
                    <div style={{ padding: '16px 18px', borderRadius: 16, background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border-1)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--foreground)', marginBottom: 4 }}>{t('Langue', 'Language')}</div>
                          <div style={{ fontSize: 13, color: 'var(--muted)' }}>{t('Langue de l’interface.', 'Interface language.')}</div>
                        </div>
                        <div style={{ display: 'inline-flex', borderRadius: 12, border: '1px solid var(--border-1)', background: 'rgba(255,255,255,0.03)', padding: 3, gap: 2 }}>
                          {(['en', 'fr'] as const).map((l) => (
                            <button
                              key={l}
                              onClick={() => setLang(l)}
                              style={{
                                height: 30, padding: '0 14px', borderRadius: 9, border: 'none', cursor: 'pointer',
                                fontSize: 12.5, fontWeight: 800, textTransform: 'uppercase',
                                background: lang === l ? 'rgba(247,147,26,0.15)' : 'transparent',
                                color: lang === l ? 'var(--accent-strong)' : 'var(--muted)',
                              }}
                            >
                              {l}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                    {/* Rentabilité */}
                    <div style={{ padding: '16px 18px', borderRadius: 16, background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border-1)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--foreground)', marginBottom: 4 }}>{t('Estimations de rentabilité', 'Profitability estimates')}</div>
                          <div style={{ fontSize: 13, color: 'var(--muted)' }}>
                            {t('Affiche le revenu estimé (jour/mois) dans le bandeau et le tableau de bord. Masqué par défaut, car peu pertinent en solo mining. En solo, la carte « Brut / jour » est remplacée par « Meilleur diff ».', 'Shows estimated revenue (day/month) in the top bar and dashboard. Hidden by default, as it’s of little relevance for solo mining. In solo, the “Gross / day” card is replaced by “Best diff”.')}
                          </div>
                        </div>
                        <button
                          onClick={() => void toggleProfitability()}
                          disabled={savingProfit}
                          style={{
                            height: 36,
                            padding: '0 16px',
                            borderRadius: 12,
                            border: showProfitability ? '1px solid rgba(74,222,128,0.3)' : '1px solid var(--border-1)',
                            background: showProfitability ? 'rgba(74,222,128,0.12)' : 'rgba(255,255,255,0.03)',
                            color: showProfitability ? 'var(--success)' : 'var(--muted)',
                            fontSize: 12.5,
                            fontWeight: 700,
                            cursor: savingProfit ? 'not-allowed' : 'pointer',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {savingProfit ? '...' : showProfitability ? t('✓ Affichées — masquer', '✓ Shown — hide') : t('Afficher', 'Show')}
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
