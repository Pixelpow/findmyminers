import { useState, useEffect, useMemo, useCallback } from 'react';
import Head from 'next/head';
import {
  Gauge,
  Cpu,
  Clock,
  Plus,
  Trash2,
  AlertTriangle,
  Save,
  Zap,
  Wand2,
  X,
  RotateCcw,
} from 'lucide-react';
import { useSmartPolling } from '@/lib/use-smart-polling';
import { useToast } from '@/components/ToastProvider';
import { fmtHash } from '@/lib/format';
import {
  TIER_ORDER,
  TIER_META,
  CHIP_LABELS,
  CHIP_MODELS,
  CHIP_FREQ_RANGE,
  CHIP_MAX_VOLTAGE,
  VOLTAGE_MIN_MV,
  detectChipFamily,
  detectChipCount,
  resolveProfile,
  profilesForChip,
  efficiencyJTh,
  clamp,
  type OcTier,
  type ChipFamily,
} from '@/lib/overclock';

type FleetMiner = {
  id: string;
  name: string;
  model?: string;
  chipType?: string;
  online: boolean;
  protocol?: string;
  capabilities?: string[];
  frequencyMHz?: number;
  coreVoltageMV?: number;
  latest?: { hashrateTHs?: number; tempAvg?: number; tempMax?: number } | null;
};

type ActiveTier = { tier: OcTier; label: string; source: 'window' | 'default' };

type FleetData = {
  fleet: FleetMiner[];
  ocScheduleEnabled?: boolean;
  ocActiveTier?: ActiveTier | null;
};

type ScheduleWindow = {
  id: string;
  label: string;
  startHour: number;
  endHour: number;
  tier: OcTier;
  days: number[];
  fanPercent?: number;
};

type OcSchedule = {
  enabled: boolean;
  defaultTier: OcTier;
  windows: ScheduleWindow[];
};

const DAY_LABELS = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];
const CHIP_ORDER: ChipFamily[] = ['BM1370', 'BM1368', 'BM1366', 'BM1397'];

/** Le mineur peut-il être piloté en overclock (freq/volt) ou via workmode ? */
function ocSupport(m: FleetMiner): 'freqvolt' | 'mode' | 'none' {
  const caps = m.capabilities || [];
  if (caps.includes('frequency') && caps.includes('voltage')) return 'freqvolt';
  if (caps.includes('mode')) return 'mode';
  return 'none';
}

function newWindowId() {
  return `oc-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

/** Palier actif pour une heure/un jour donné (miroir client du scheduler). */
function tierAtHour(windows: ScheduleWindow[], defaultTier: OcTier, hour: number, day: number): OcTier {
  for (const w of windows) {
    const dayOk = !w.days || w.days.length === 0 || w.days.includes(day);
    if (!dayOk) continue;
    const inWindow = w.startHour === w.endHour
      ? true
      : w.startHour < w.endHour
        ? hour >= w.startHour && hour < w.endHour
        : hour >= w.startHour || hour < w.endHour;
    if (inWindow) return w.tier;
  }
  return defaultTier;
}

export default function OverclockPage() {
  const { toast } = useToast();
  const { data: fleetData } = useSmartPolling<FleetData>(
    async () => {
      const res = await fetch('/api/miner/fleet');
      if (!res.ok) throw new Error('Flotte indisponible');
      return res.json();
    },
    { intervalMs: 15_000, cacheKey: 'fleet' },
  );

  const miners = useMemo(() => (fleetData?.fleet || []).filter((m) => ocSupport(m) !== 'none'), [fleetData]);

  // ---- Application rapide -------------------------------------------------
  const [selectedTier, setSelectedTier] = useState<OcTier>('balanced');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [applying, setApplying] = useState(false);
  const [confirmApply, setConfirmApply] = useState(false);

  // Sélectionne par défaut tous les mineurs en ligne pilotables.
  useEffect(() => {
    if (selected.size === 0 && miners.length > 0) {
      setSelected(new Set(miners.filter((m) => m.online).map((m) => m.id)));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [miners.length]);

  const toggleMiner = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });

  const allSelected = miners.length > 0 && miners.every((m) => selected.has(m.id));
  const toggleAll = () =>
    setSelected(allSelected ? new Set() : new Set(miners.map((m) => m.id)));

  const selectedMiners = useMemo(() => miners.filter((m) => selected.has(m.id)), [miners, selected]);

  /** Résolution du réglage cible par mineur pour le palier choisi. */
  const preview = useMemo(() => selectedMiners.map((m) => {
    const chip = detectChipFamily({ chipType: m.chipType, model: m.model });
    const count = detectChipCount(m.model);
    const support = ocSupport(m);
    const profile = resolveProfile(chip, selectedTier);
    return {
      miner: m,
      chip,
      support,
      freqMHz: profile.freqMHz,
      coreVoltageMV: clamp(profile.coreVoltageMV, VOLTAGE_MIN_MV, CHIP_MAX_VOLTAGE[chip]),
      targetTHs: profile.perChipTHs * count,
      currentTHs: m.latest?.hashrateTHs || 0,
    };
  }), [selectedMiners, selectedTier]);

  const targetTotalTHs = preview.reduce((s, p) => s + p.targetTHs, 0);
  const currentTotalTHs = preview.reduce((s, p) => s + p.currentTHs, 0);

  const runApply = useCallback(async () => {
    if (selectedMiners.length === 0) return;
    setApplying(true);
    setConfirmApply(false);
    try {
      const chipByMiner: Record<string, string> = {};
      selectedMiners.forEach((m) => { if (m.chipType) chipByMiner[m.id] = m.chipType; });
      const res = await fetch('/api/overclock/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ minerIds: selectedMiners.map((m) => m.id), tier: selectedTier, chipByMiner }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Échec');
      const ok = (json.results || []).filter((r: { ok: boolean }) => r.ok).length;
      const fail = (json.results || []).length - ok;
      toast(fail ? 'warning' : 'success', `Palier ${TIER_META[selectedTier].label} appliqué : ${ok} OK${fail ? `, ${fail} en échec` : ''}`);
    } catch (error) {
      toast('error', error instanceof Error ? error.message : 'Application échouée');
    } finally {
      setApplying(false);
    }
  }, [selectedMiners, selectedTier, toast]);

  // ---- Réglage manuel (expert) -------------------------------------------
  const freqVoltMiners = useMemo(() => miners.filter((m) => ocSupport(m) === 'freqvolt'), [miners]);
  const [manualId, setManualId] = useState('');
  const [manualFreq, setManualFreq] = useState(525);
  const [manualVolt, setManualVolt] = useState(1150);
  const [manualBusy, setManualBusy] = useState(false);

  const manualMiner = freqVoltMiners.find((m) => m.id === manualId);
  const manualChip = manualMiner ? detectChipFamily({ chipType: manualMiner.chipType, model: manualMiner.model }) : 'generic';
  const manualRange = CHIP_FREQ_RANGE[manualChip];
  const manualMaxV = CHIP_MAX_VOLTAGE[manualChip];

  // Initialise les curseurs sur les valeurs actuelles du mineur sélectionné.
  useEffect(() => {
    if (!manualId && freqVoltMiners.length > 0) setManualId(freqVoltMiners[0].id);
  }, [freqVoltMiners, manualId]);
  useEffect(() => {
    if (manualMiner) {
      setManualFreq(manualMiner.frequencyMHz || resolveProfile(manualChip, 'balanced').freqMHz);
      setManualVolt(manualMiner.coreVoltageMV || resolveProfile(manualChip, 'balanced').coreVoltageMV);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [manualId]);

  const runManual = async () => {
    if (!manualMiner) return;
    setManualBusy(true);
    try {
      const freqMHz = clamp(manualFreq, manualRange.min, manualRange.max);
      const coreVoltageMV = clamp(manualVolt, VOLTAGE_MIN_MV, manualMaxV);
      const res = await fetch('/api/overclock/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          minerIds: [manualMiner.id],
          custom: { freqMHz, coreVoltageMV },
          chipByMiner: manualMiner.chipType ? { [manualMiner.id]: manualMiner.chipType } : {},
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Échec');
      toast('success', `${manualMiner.name} → ${freqMHz} MHz / ${coreVoltageMV} mV`);
    } catch (error) {
      toast('error', error instanceof Error ? error.message : 'Application échouée');
    } finally {
      setManualBusy(false);
    }
  };

  const resetStock = async () => {
    if (!manualMiner) return;
    const stock = resolveProfile(manualChip, 'balanced');
    setManualFreq(stock.freqMHz);
    setManualVolt(stock.coreVoltageMV);
  };

  // ---- Planification ------------------------------------------------------
  const [schedule, setSchedule] = useState<OcSchedule>({ enabled: false, defaultTier: 'balanced', windows: [] });
  const [savingSchedule, setSavingSchedule] = useState(false);
  const [previewDay, setPreviewDay] = useState(new Date().getDay());

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/miner/config');
        if (!res.ok) return;
        const config = await res.json();
        if (config.ocSchedule) {
          setSchedule({
            enabled: !!config.ocSchedule.enabled,
            defaultTier: config.ocSchedule.defaultTier || 'balanced',
            windows: Array.isArray(config.ocSchedule.windows) ? config.ocSchedule.windows : [],
          });
        } else if (config.nightSchedule?.enabled) {
          // Migration douce : reprend l'ancien mode nuit comme créneau Éco.
          setSchedule({
            enabled: false,
            defaultTier: 'balanced',
            windows: [{
              id: newWindowId(),
              label: 'Nuit (repris du mode nuit)',
              startHour: config.nightSchedule.startHour ?? 22,
              endHour: config.nightSchedule.endHour ?? 7,
              tier: 'eco',
              days: [],
              fanPercent: config.nightSchedule.fanPercent,
            }],
          });
        }
      } catch { /* ignore */ }
    })();
  }, []);

  const addWindow = () =>
    setSchedule((s) => ({
      ...s,
      windows: [...s.windows, { id: newWindowId(), label: 'Nuit', startHour: 22, endHour: 7, tier: 'eco', days: [], fanPercent: 40 }],
    }));

  const updateWindow = (id: string, patch: Partial<ScheduleWindow>) =>
    setSchedule((s) => ({ ...s, windows: s.windows.map((w) => (w.id === id ? { ...w, ...patch } : w)) }));

  const removeWindow = (id: string) =>
    setSchedule((s) => ({ ...s, windows: s.windows.filter((w) => w.id !== id) }));

  const toggleWindowDay = (id: string, day: number) =>
    setSchedule((s) => ({
      ...s,
      windows: s.windows.map((w) => {
        if (w.id !== id) return w;
        const days = w.days.includes(day) ? w.days.filter((d) => d !== day) : [...w.days, day].sort();
        return { ...w, days };
      }),
    }));

  const saveSchedule = async () => {
    setSavingSchedule(true);
    try {
      const res = await fetch('/api/miner/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ocSchedule: schedule }),
      });
      if (!res.ok) throw new Error('Échec de l’enregistrement');
      toast('success', schedule.enabled ? 'Planification enregistrée et active' : 'Planification enregistrée (désactivée)');
    } catch (error) {
      toast('error', error instanceof Error ? error.message : 'Enregistrement échoué');
    } finally {
      setSavingSchedule(false);
    }
  };

  const needsConfirm = selectedTier === 'extreme' || selectedMiners.length > 1;
  const onApplyClick = () => {
    if (selectedMiners.length === 0) return;
    if (needsConfirm) setConfirmApply(true);
    else void runApply();
  };

  const activeTier = fleetData?.ocActiveTier;

  return (
    <>
      <Head><title>Overclock · FindMyMiners</title></Head>

      <div className="space-y-6">
        {/* Intro pédagogique */}
        <section className="nova-glass rounded-2xl p-6 relative overflow-hidden">
          <div className="absolute inset-0 pointer-events-none bg-[radial-gradient(circle_at_top_right,rgba(247,147,26,0.10),transparent_40%)]" />
          <div className="relative">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-xl bg-btc-500/10 border border-btc-500/25 flex items-center justify-center">
                <Gauge className="w-5 h-5 text-btc-500" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-slate-100">Overclock & undervolt</h2>
                <p className="text-[13px] text-slate-400">Règle la fréquence (hashrate) et la tension (stabilité) de tes mineurs, ou programme des paliers selon l’heure.</p>
              </div>
              {activeTier && (
                <span className={`ml-auto flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs font-semibold ${TIER_META[activeTier.tier].chip} ${TIER_META[activeTier.tier].text}`}>
                  {TIER_META[activeTier.tier].emoji} Palier actif : {TIER_META[activeTier.tier].label}
                  <span className="text-slate-500 font-normal">({activeTier.source === 'window' ? activeTier.label : 'planning'})</span>
                </span>
              )}
            </div>
            <div className="flex items-start gap-2.5 rounded-xl border border-rose-500/25 bg-rose-500/[0.07] px-4 py-3 max-w-3xl">
              <AlertTriangle className="w-4 h-4 text-rose-400 mt-0.5 shrink-0" />
              <p className="text-[12.5px] text-rose-200/90 leading-relaxed">
                <strong className="text-rose-300">Réglages avancés, à tes risques.</strong> Une tension trop élevée ou un refroidissement insuffisant peut réduire la durée de vie des puces, voire endommager définitivement ton mineur. N’utilise cette fonction que si tu sais ce que tu fais — tu restes responsable des valeurs appliquées. Monte par paliers et surveille la température.
              </p>
            </div>
          </div>
        </section>

        {/* Application rapide */}
        <section className="nova-glass rounded-2xl p-6">
          <div className="flex items-center gap-2 mb-4">
            <Zap className="w-[18px] h-[18px] text-btc-500" />
            <h3 className="text-sm font-semibold text-slate-200">Application rapide</h3>
            <span className="text-xs text-slate-500">choisis un palier, applique-le à la sélection</span>
          </div>

          {/* Sélecteur de palier */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
            {TIER_ORDER.map((tier) => {
              const meta = TIER_META[tier];
              const active = selectedTier === tier;
              return (
                <button
                  key={tier}
                  onClick={() => setSelectedTier(tier)}
                  className={`focus-ring text-left rounded-xl border p-3.5 transition-all ${active ? `${meta.chip} ring-2 ${meta.ring}` : 'border-white/5 bg-white/[0.02] hover:bg-white/[0.04]'}`}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-base">{meta.emoji}</span>
                    <span className={`text-sm font-semibold ${active ? meta.text : 'text-slate-200'}`}>{meta.label}</span>
                    {meta.danger && <AlertTriangle className="w-3.5 h-3.5 text-rose-400 ml-auto" />}
                  </div>
                  <p className="text-[11px] text-slate-500 leading-snug">{meta.short}</p>
                </button>
              );
            })}
          </div>

          <p className="text-[12px] text-slate-400 mb-4 leading-relaxed">{TIER_META[selectedTier].desc}</p>

          {/* Liste des mineurs */}
          {miners.length === 0 ? (
            <div className="text-sm text-slate-500 py-8 text-center border border-dashed border-white/10 rounded-xl">
              Aucun mineur pilotable détecté. Les Bitaxe (AxeOS) et ASIC CGMiner apparaissent ici une fois en ligne.
            </div>
          ) : (
            <div className="rounded-xl border border-white/5 overflow-hidden">
              <div className="flex items-center gap-3 px-4 py-2.5 bg-white/[0.02] border-b border-white/5 text-[11px] uppercase tracking-wider text-slate-500 font-semibold">
                <input type="checkbox" checked={allSelected} onChange={toggleAll} className="accent-btc-500 w-3.5 h-3.5" />
                <span className="flex-1">Mineur</span>
                <span className="w-24 hidden sm:block">Puce</span>
                <span className="w-28 text-right">Actuel</span>
                <span className="w-32 text-right">Cible ({TIER_META[selectedTier].label})</span>
              </div>
              {preview.length === 0 && (
                <div className="px-4 py-6 text-center text-[13px] text-slate-500">Coche au moins un mineur pour voir l’aperçu.</div>
              )}
              {miners.map((m) => {
                const chip = detectChipFamily({ chipType: m.chipType, model: m.model });
                const support = ocSupport(m);
                const profile = resolveProfile(chip, selectedTier);
                const isSel = selected.has(m.id);
                const v = clamp(profile.coreVoltageMV, VOLTAGE_MIN_MV, CHIP_MAX_VOLTAGE[chip]);
                return (
                  <div key={m.id} className={`flex items-center gap-3 px-4 py-3 border-b border-white/5 last:border-0 transition-colors ${isSel ? 'bg-btc-500/[0.04]' : 'hover:bg-white/[0.02]'}`}>
                    <input type="checkbox" checked={isSel} onChange={() => toggleMiner(m.id)} className="accent-btc-500 w-3.5 h-3.5" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className={`w-1.5 h-1.5 rounded-full ${m.online ? 'bg-emerald-500 dot-glow-emerald' : 'bg-slate-600'}`} />
                        <span className="text-[13px] font-medium text-slate-200 truncate">{m.name}</span>
                      </div>
                      <span className="text-[11px] text-slate-500">{m.model || m.protocol}</span>
                    </div>
                    <span className="w-24 hidden sm:flex items-center gap-1.5 text-[11px] text-slate-400">
                      <Cpu className="w-3 h-3 text-slate-500" />{chip === 'generic' ? '—' : chip}
                    </span>
                    <span className="w-28 text-right text-[12px] font-mono text-slate-400">
                      {support === 'freqvolt'
                        ? (m.frequencyMHz ? `${m.frequencyMHz} / ${m.coreVoltageMV || '?'}` : '—')
                        : fmtHash(m.latest?.hashrateTHs || 0)}
                    </span>
                    <span className="w-32 text-right text-[12px] font-mono">
                      {support === 'freqvolt'
                        ? <span className={TIER_META[selectedTier].text}>{profile.freqMHz} MHz / {v} mV</span>
                        : <span className="text-slate-300">mode {selectedTier === 'eco' ? 'éco' : selectedTier === 'balanced' ? 'normal' : 'perf'}</span>}
                    </span>
                  </div>
                );
              })}
            </div>
          )}

          {/* Barre d'action */}
          {selectedMiners.length > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-3 mt-4">
              <div className="text-[12px] text-slate-400">
                Hashrate estimé : <span className="font-mono text-slate-300">{fmtHash(currentTotalTHs)}</span>
                <span className="text-slate-600 mx-1.5">→</span>
                <span className={`font-mono ${targetTotalTHs >= currentTotalTHs ? 'text-emerald-400' : 'text-amber-400'}`}>{fmtHash(targetTotalTHs)}</span>
                <span className="text-slate-600 ml-2">sur {selectedMiners.length} mineur{selectedMiners.length > 1 ? 's' : ''}</span>
              </div>
              <button
                onClick={onApplyClick}
                disabled={applying}
                className={`focus-ring px-4 py-2 rounded-lg text-sm font-semibold transition-colors disabled:opacity-50 ${selectedTier === 'extreme' ? 'bg-rose-500/15 text-rose-300 border border-rose-500/30 hover:bg-rose-500/25' : 'bg-btc-500/15 text-btc-400 border border-btc-500/30 hover:bg-btc-500/25'}`}
              >
                {applying ? 'Application…' : `Appliquer ${TIER_META[selectedTier].label} à ${selectedMiners.length} mineur${selectedMiners.length > 1 ? 's' : ''}`}
              </button>
            </div>
          )}
        </section>

        {/* Catalogue + réglage manuel */}
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
          {/* Catalogue par puce */}
          <section className="nova-glass rounded-2xl p-6">
            <div className="flex items-center gap-2 mb-4">
              <Cpu className="w-[18px] h-[18px] text-blue-400" />
              <h3 className="text-sm font-semibold text-slate-200">Catalogue par puce</h3>
            </div>
            <div className="space-y-5">
              {CHIP_ORDER.map((chip) => (
                <div key={chip}>
                  <div className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold mb-0.5">{CHIP_LABELS[chip]}</div>
                  <div className="text-[10.5px] text-slate-600 mb-2 leading-snug">{CHIP_MODELS[chip]}</div>
                  <div className="grid grid-cols-4 gap-2">
                    {profilesForChip(chip).map(({ tier, profile }) => {
                      const meta = TIER_META[tier];
                      return (
                        <div key={tier} className={`rounded-lg border p-2.5 ${meta.chip}`}>
                          <div className={`text-[11px] font-semibold mb-1 ${meta.text}`}>{meta.emoji} {meta.label}</div>
                          <div className="text-[12px] font-mono text-slate-200 leading-tight">{profile.freqMHz}<span className="text-slate-500 text-[10px]"> MHz</span></div>
                          <div className="text-[12px] font-mono text-slate-300 leading-tight">{profile.coreVoltageMV}<span className="text-slate-500 text-[10px]"> mV</span></div>
                          <div className="text-[10px] text-slate-500 mt-1">{profile.perChipTHs.toFixed(2)} TH · {efficiencyJTh(profile).toFixed(1)} J/TH</div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
            <p className="text-[11px] text-slate-500 mt-4 leading-relaxed">
              Valeurs par puce (Solo Satoshi / D-Central), tension bornée à la limite 24/7. Le hashrate réel dépend du refroidissement et du silicium.
            </p>
          </section>

          {/* Réglage manuel expert */}
          <section className="nova-glass rounded-2xl p-6">
            <div className="flex items-center gap-2 mb-4">
              <Wand2 className="w-[18px] h-[18px] text-btc-500" />
              <h3 className="text-sm font-semibold text-slate-200">Réglage manuel (expert)</h3>
            </div>
            {freqVoltMiners.length === 0 ? (
              <div className="text-sm text-slate-500 py-8 text-center border border-dashed border-white/10 rounded-xl">
                Aucun mineur AxeOS (freq/voltage) en ligne. Le réglage manuel n’est disponible que pour les Bitaxe.
              </div>
            ) : (
              <div className="space-y-5">
                <div>
                  <label className="block text-[12px] text-slate-400 mb-1.5">Mineur</label>
                  <select value={manualId} onChange={(e) => setManualId(e.target.value)} className="focus-ring w-full bg-obsidian-950 border border-white/10 rounded-lg py-2 px-3 text-sm text-slate-200">
                    {freqVoltMiners.map((m) => (
                      <option key={m.id} value={m.id} style={{ background: '#0a0a0c' }}>{m.name} · {detectChipFamily({ chipType: m.chipType, model: m.model })}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-[12px] text-slate-400">Fréquence</label>
                    <span className="text-[12px] font-mono text-btc-400">{manualFreq} MHz</span>
                  </div>
                  <input type="range" min={manualRange.min} max={manualRange.max} step={5} value={clamp(manualFreq, manualRange.min, manualRange.max)} onChange={(e) => setManualFreq(Number(e.target.value))} className="w-full accent-btc-500" />
                  <div className="flex justify-between text-[10px] text-slate-600 mt-0.5"><span>{manualRange.min}</span><span>{manualRange.max} MHz</span></div>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-[12px] text-slate-400">Tension cœur</label>
                    <span className={`text-[12px] font-mono ${manualVolt > manualMaxV - 50 ? 'text-rose-400' : 'text-slate-300'}`}>{manualVolt} mV</span>
                  </div>
                  <input type="range" min={VOLTAGE_MIN_MV} max={manualMaxV} step={5} value={clamp(manualVolt, VOLTAGE_MIN_MV, manualMaxV)} onChange={(e) => setManualVolt(Number(e.target.value))} className="w-full accent-btc-500" />
                  <div className="flex justify-between text-[10px] text-slate-600 mt-0.5"><span>{VOLTAGE_MIN_MV}</span><span>{manualMaxV} mV (max {manualChip})</span></div>
                </div>

                {manualVolt > manualMaxV - 50 && (
                  <div className="flex items-start gap-2 text-[11px] text-rose-300 bg-rose-500/10 border border-rose-500/20 rounded-lg p-2.5">
                    <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                    Tu approches de la tension maximale sûre de cette puce. Assure-toi d’un refroidissement renforcé.
                  </div>
                )}

                <div className="flex items-center gap-2">
                  <button onClick={runManual} disabled={manualBusy} className="focus-ring flex-1 px-4 py-2 rounded-lg text-sm font-semibold bg-btc-500/15 text-btc-400 border border-btc-500/30 hover:bg-btc-500/25 transition-colors disabled:opacity-50">
                    {manualBusy ? 'Application…' : 'Appliquer à ce mineur'}
                  </button>
                  <button onClick={resetStock} className="focus-ring px-3 py-2 rounded-lg text-sm text-slate-400 border border-white/10 hover:text-slate-200 hover:bg-white/[0.04] transition-colors" title="Revenir aux valeurs d’usine">
                    <RotateCcw className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )}
          </section>
        </div>

        {/* Planification horaire */}
        <section className="nova-glass rounded-2xl p-6">
          <div className="flex flex-wrap items-center gap-3 mb-4">
            <Clock className="w-[18px] h-[18px] text-blue-400" />
            <h3 className="text-sm font-semibold text-slate-200">Planification horaire</h3>
            <label className="ml-auto flex items-center gap-2 text-[13px] text-slate-300 cursor-pointer">
              <input type="checkbox" checked={schedule.enabled} onChange={(e) => setSchedule((s) => ({ ...s, enabled: e.target.checked }))} className="accent-btc-500 w-4 h-4" />
              Activer le planning
            </label>
          </div>
          <p className="text-[12px] text-slate-400 mb-4 leading-relaxed max-w-3xl">
            Programme des créneaux (ex. <span className="text-emerald-400">Éco la nuit</span>, <span className="text-btc-400">Turbo en journée</span>). Le palier est appliqué automatiquement côté serveur — même navigateur fermé. Hors créneau, le palier par défaut s’applique. Le mode vacances suspend le planning.
          </p>

          {/* Timeline 24h */}
          <div className="mb-5">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-[11px] text-slate-500">Aperçu</span>
              <select value={previewDay} onChange={(e) => setPreviewDay(Number(e.target.value))} className="bg-obsidian-950 border border-white/10 rounded-md py-0.5 px-1.5 text-[11px] text-slate-300">
                {DAY_LABELS.map((d, i) => <option key={i} value={i} style={{ background: '#0a0a0c' }}>{d}</option>)}
              </select>
            </div>
            <div className="flex rounded-lg overflow-hidden border border-white/5">
              {Array.from({ length: 24 }, (_, h) => {
                const tier = schedule.enabled ? tierAtHour(schedule.windows, schedule.defaultTier, h, previewDay) : schedule.defaultTier;
                const meta = TIER_META[tier];
                return (
                  <div key={h} className={`flex-1 h-9 border-r border-obsidian-950/50 last:border-0 ${meta.chip}`} title={`${String(h).padStart(2, '0')}:00 — ${meta.label}`} />
                );
              })}
            </div>
            <div className="flex justify-between text-[9px] text-slate-600 mt-1 px-0.5"><span>00h</span><span>06h</span><span>12h</span><span>18h</span><span>24h</span></div>
          </div>

          {/* Palier par défaut */}
          <div className="flex flex-wrap items-center gap-3 mb-4">
            <span className="text-[12px] text-slate-400">Hors créneau :</span>
            <div className="flex gap-1.5">
              {TIER_ORDER.map((tier) => (
                <button key={tier} onClick={() => setSchedule((s) => ({ ...s, defaultTier: tier }))} className={`focus-ring px-2.5 py-1 rounded-md text-[12px] border transition-colors ${schedule.defaultTier === tier ? `${TIER_META[tier].chip} ${TIER_META[tier].text}` : 'border-white/5 text-slate-400 hover:bg-white/[0.04]'}`}>
                  {TIER_META[tier].emoji} {TIER_META[tier].label}
                </button>
              ))}
            </div>
          </div>

          {/* Créneaux */}
          <div className="space-y-3">
            {schedule.windows.map((w) => (
              <div key={w.id} className="rounded-xl border border-white/5 bg-white/[0.02] p-4">
                <div className="flex flex-wrap items-end gap-3">
                  <div className="flex-1 min-w-[140px]">
                    <label className="block text-[11px] text-slate-500 mb-1">Nom</label>
                    <input value={w.label} onChange={(e) => updateWindow(w.id, { label: e.target.value })} className="focus-ring w-full bg-obsidian-950 border border-white/10 rounded-lg py-1.5 px-2.5 text-[13px] text-slate-200" />
                  </div>
                  <div>
                    <label className="block text-[11px] text-slate-500 mb-1">De</label>
                    <select value={w.startHour} onChange={(e) => updateWindow(w.id, { startHour: Number(e.target.value) })} className="bg-obsidian-950 border border-white/10 rounded-lg py-1.5 px-2 text-[13px] text-slate-200">
                      {Array.from({ length: 24 }, (_, i) => <option key={i} value={i} style={{ background: '#0a0a0c' }}>{String(i).padStart(2, '0')}:00</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[11px] text-slate-500 mb-1">À</label>
                    <select value={w.endHour} onChange={(e) => updateWindow(w.id, { endHour: Number(e.target.value) })} className="bg-obsidian-950 border border-white/10 rounded-lg py-1.5 px-2 text-[13px] text-slate-200">
                      {Array.from({ length: 24 }, (_, i) => <option key={i} value={i} style={{ background: '#0a0a0c' }}>{String(i).padStart(2, '0')}:00</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[11px] text-slate-500 mb-1">Palier</label>
                    <select value={w.tier} onChange={(e) => updateWindow(w.id, { tier: e.target.value as OcTier })} className="bg-obsidian-950 border border-white/10 rounded-lg py-1.5 px-2 text-[13px] text-slate-200">
                      {TIER_ORDER.map((t) => <option key={t} value={t} style={{ background: '#0a0a0c' }}>{TIER_META[t].label}</option>)}
                    </select>
                  </div>
                  <div className="w-20">
                    <label className="block text-[11px] text-slate-500 mb-1">Ventilo %</label>
                    <input type="number" min={0} max={100} value={w.fanPercent ?? ''} placeholder="auto" onChange={(e) => updateWindow(w.id, { fanPercent: e.target.value === '' ? undefined : Number(e.target.value) })} className="focus-ring w-full bg-obsidian-950 border border-white/10 rounded-lg py-1.5 px-2 text-[13px] text-slate-200" />
                  </div>
                  <button onClick={() => removeWindow(w.id)} className="focus-ring p-2 rounded-lg text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 transition-colors" title="Supprimer ce créneau">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
                <div className="flex items-center gap-1.5 mt-3">
                  <span className="text-[11px] text-slate-500 mr-1">Jours :</span>
                  {DAY_LABELS.map((d, i) => {
                    const on = w.days.length === 0 || w.days.includes(i);
                    const allDays = w.days.length === 0;
                    return (
                      <button key={i} onClick={() => toggleWindowDay(w.id, i)} className={`focus-ring px-2 py-0.5 rounded text-[11px] border transition-colors ${on ? 'bg-btc-500/10 border-btc-500/25 text-btc-400' : 'border-white/5 text-slate-500 hover:bg-white/[0.04]'}`} title={allDays ? 'Tous les jours (clique pour restreindre)' : undefined}>
                        {d}
                      </button>
                    );
                  })}
                  {w.days.length === 0 && <span className="text-[10px] text-slate-600 ml-1">tous les jours</span>}
                </div>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-3 mt-4">
            <button onClick={addWindow} className="focus-ring inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-[13px] text-slate-300 border border-white/10 hover:bg-white/[0.04] transition-colors">
              <Plus className="w-4 h-4" /> Ajouter un créneau
            </button>
            <button onClick={saveSchedule} disabled={savingSchedule} className="focus-ring inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-[13px] font-semibold bg-btc-500/15 text-btc-400 border border-btc-500/30 hover:bg-btc-500/25 transition-colors disabled:opacity-50 ml-auto">
              <Save className="w-4 h-4" /> {savingSchedule ? 'Enregistrement…' : 'Enregistrer la planification'}
            </button>
          </div>
        </section>
      </div>

      {/* Confirmation d'application (flotte / extrême) */}
      {confirmApply && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" data-modal-overlay onClick={() => setConfirmApply(false)}>
          <div className="absolute inset-0 bg-obsidian-950/70 backdrop-blur-sm" />
          <div className="relative w-full max-w-lg nova-glass rounded-2xl p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2 mb-1">
              {selectedTier === 'extreme'
                ? <AlertTriangle className="w-5 h-5 text-rose-400" />
                : <Zap className="w-5 h-5 text-btc-500" />}
              <h3 className="text-base font-semibold text-slate-100">Confirmer l’application</h3>
              <button onClick={() => setConfirmApply(false)} className="ml-auto p-1 text-slate-500 hover:text-slate-200"><X className="w-4 h-4" /></button>
            </div>
            <p className="text-[13px] text-slate-400 mb-4">
              Palier <span className={`font-semibold ${TIER_META[selectedTier].text}`}>{TIER_META[selectedTier].emoji} {TIER_META[selectedTier].label}</span> sur <strong className="text-slate-200">{selectedMiners.length}</strong> mineur{selectedMiners.length > 1 ? 's' : ''}.
              {selectedTier === 'extreme' && <span className="block mt-1 text-rose-300">⚠ Palier extrême : refroidissement renforcé requis, risque d’usure accélérée.</span>}
            </p>
            <div className="max-h-52 overflow-y-auto rounded-lg border border-white/5 divide-y divide-white/5 mb-4">
              {preview.map((p) => (
                <div key={p.miner.id} className="flex items-center justify-between gap-2 px-3 py-2 text-[12px]">
                  <span className="text-slate-300 truncate">{p.miner.name}</span>
                  <span className="font-mono text-slate-400 shrink-0">
                    {p.support === 'freqvolt' ? `${p.freqMHz} MHz / ${p.coreVoltageMV} mV` : `mode ${selectedTier === 'eco' ? 'éco' : selectedTier === 'balanced' ? 'normal' : 'perf'}`}
                  </span>
                </div>
              ))}
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={() => setConfirmApply(false)} className="focus-ring px-4 py-2 rounded-lg text-sm text-slate-300 border border-white/10 hover:bg-white/[0.04]">Annuler</button>
              <button onClick={() => void runApply()} className={`focus-ring px-4 py-2 rounded-lg text-sm font-semibold ${selectedTier === 'extreme' ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40 hover:bg-rose-500/30' : 'bg-btc-500/20 text-btc-300 border border-btc-500/40 hover:bg-btc-500/30'}`}>Confirmer</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
