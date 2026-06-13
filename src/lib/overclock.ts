/**
 * Catalogue d'overclock / undervolt partagé (client + serveur).
 *
 * Sur un Bitaxe / NerdQAxe, l'overclock se résume à deux réglages PAR PUCE :
 *   - la fréquence ASIC (MHz)
 *   - la tension cœur (mV)
 * C'est exactement ce que pilotent les capacités `frequency` et `voltage` du
 * driver AxeOS. L'enveloppe sûre dépend de la PUCE (BM1370/1368/1366/1397),
 * pas du modèle de carte : on indexe donc les profils par famille de puce.
 *
 * Pour les ASIC CGMiner/Avalon (pas de réglage freq/volt direct), l'équivalent
 * est le `workmode` (0 = éco, 1 = normal, 2 = perf) — voir `tierToWorkmode`.
 *
 * Valeurs vérifiées via les guides communautaires (Solo Satoshi, D-Central).
 * Tension plafonnée à la limite « 24/7 » de chaque puce.
 */

export type OcTier = 'eco' | 'balanced' | 'turbo' | 'extreme';
export type ChipFamily = 'BM1370' | 'BM1368' | 'BM1366' | 'BM1397' | 'generic';

export type OcProfile = {
  /** Fréquence ASIC en MHz. */
  freqMHz: number;
  /** Tension cœur en mV. */
  coreVoltageMV: number;
  /** Hashrate approximatif PAR PUCE (TH/s). */
  perChipTHs: number;
  /** Consommation approximative PAR PUCE (W). */
  perChipW: number;
};

export const TIER_ORDER: OcTier[] = ['eco', 'balanced', 'turbo', 'extreme'];

export type TierMeta = {
  label: string;
  emoji: string;
  short: string;
  desc: string;
  /** Classes Tailwind (puce / bordure / texte) pour le thème nova. */
  chip: string;
  text: string;
  ring: string;
  dot: string;
  /** Profil le plus poussé : avertissement explicite avant application. */
  danger?: boolean;
};

export const TIER_META: Record<OcTier, TierMeta> = {
  eco: {
    label: 'Éco',
    emoji: '🌙',
    short: 'Silencieux & frais',
    desc: 'Tension et fréquence réduites : moins de bruit, moins de chaleur, moins de conso. Idéal la nuit.',
    chip: 'bg-emerald-500/10 border-emerald-500/25',
    text: 'text-emerald-400',
    ring: 'ring-emerald-500/40',
    dot: 'bg-emerald-500 dot-glow-emerald',
  },
  balanced: {
    label: 'Équilibré',
    emoji: '⚖️',
    short: 'Réglage d’usine',
    desc: 'Valeurs proches du stock : le meilleur compromis stabilité / efficacité au quotidien.',
    chip: 'bg-slate-500/10 border-slate-400/25',
    text: 'text-slate-200',
    ring: 'ring-slate-400/40',
    dot: 'bg-slate-400',
  },
  turbo: {
    label: 'Turbo',
    emoji: '⚡',
    short: 'Plus de hashrate',
    desc: 'Overclock sain : gain de hashrate notable en gardant des marges thermiques. Ventilation à surveiller.',
    chip: 'bg-btc-500/10 border-btc-500/25',
    text: 'text-btc-500',
    ring: 'ring-btc-500/40',
    dot: 'bg-btc-500 dot-glow-btc',
  },
  extreme: {
    label: 'Extrême',
    emoji: '🔥',
    short: 'Refroidissement requis',
    desc: 'Pousse la puce près de ses limites. Réservé aux setups avec dissipateurs/ventilation renforcés. Risque d’instabilité et d’usure accélérée.',
    chip: 'bg-rose-500/10 border-rose-500/30',
    text: 'text-rose-400',
    ring: 'ring-rose-500/40',
    dot: 'bg-rose-500 dot-glow-rose',
    danger: true,
  },
};

/** Étiquette lisible de la famille de puce (carte la plus connue). */
export const CHIP_LABELS: Record<ChipFamily, string> = {
  BM1370: 'BM1370 — Bitaxe Gamma / NerdQAxe++',
  BM1368: 'BM1368 — Bitaxe Supra (60x)',
  BM1366: 'BM1366 — Bitaxe Ultra (40x)',
  BM1397: 'BM1397 — Bitaxe Max (legacy)',
  generic: 'AxeOS générique',
};

/** Tension maximale recommandée en fonctionnement continu (mV). */
export const CHIP_MAX_VOLTAGE: Record<ChipFamily, number> = {
  BM1370: 1300,
  BM1368: 1300,
  BM1366: 1300,
  BM1397: 1500,
  generic: 1250,
};

/** Plage de fréquence autorisée pour le réglage manuel (MHz). */
export const CHIP_FREQ_RANGE: Record<ChipFamily, { min: number; max: number }> = {
  BM1370: { min: 400, max: 900 },
  BM1368: { min: 400, max: 700 },
  BM1366: { min: 400, max: 650 },
  BM1397: { min: 350, max: 650 },
  generic: { min: 400, max: 650 },
};

export const VOLTAGE_MIN_MV = 1000;

const PROFILES: Record<ChipFamily, Record<OcTier, OcProfile>> = {
  BM1370: {
    eco: { freqMHz: 490, coreVoltageMV: 1100, perChipTHs: 0.98, perChipW: 12 },
    balanced: { freqMHz: 525, coreVoltageMV: 1150, perChipTHs: 1.07, perChipW: 15 },
    turbo: { freqMHz: 600, coreVoltageMV: 1200, perChipTHs: 1.27, perChipW: 17 },
    extreme: { freqMHz: 750, coreVoltageMV: 1250, perChipTHs: 1.55, perChipW: 22 },
  },
  BM1368: {
    eco: { freqMHz: 450, coreVoltageMV: 1150, perChipTHs: 0.46, perChipW: 11 },
    balanced: { freqMHz: 490, coreVoltageMV: 1200, perChipTHs: 0.55, perChipW: 14 },
    turbo: { freqMHz: 550, coreVoltageMV: 1250, perChipTHs: 0.68, perChipW: 17 },
    extreme: { freqMHz: 650, coreVoltageMV: 1300, perChipTHs: 0.85, perChipW: 22 },
  },
  BM1366: {
    eco: { freqMHz: 425, coreVoltageMV: 1150, perChipTHs: 0.42, perChipW: 11 },
    balanced: { freqMHz: 485, coreVoltageMV: 1200, perChipTHs: 0.49, perChipW: 13 },
    turbo: { freqMHz: 575, coreVoltageMV: 1250, perChipTHs: 0.62, perChipW: 17 },
    extreme: { freqMHz: 625, coreVoltageMV: 1300, perChipTHs: 0.72, perChipW: 21 },
  },
  BM1397: {
    eco: { freqMHz: 400, coreVoltageMV: 1350, perChipTHs: 0.40, perChipW: 13 },
    balanced: { freqMHz: 450, coreVoltageMV: 1400, perChipTHs: 0.49, perChipW: 15 },
    turbo: { freqMHz: 525, coreVoltageMV: 1450, perChipTHs: 0.58, perChipW: 18 },
    extreme: { freqMHz: 575, coreVoltageMV: 1490, perChipTHs: 0.64, perChipW: 21 },
  },
  generic: {
    eco: { freqMHz: 450, coreVoltageMV: 1100, perChipTHs: 0.50, perChipW: 12 },
    balanced: { freqMHz: 500, coreVoltageMV: 1150, perChipTHs: 0.60, perChipW: 14 },
    turbo: { freqMHz: 575, coreVoltageMV: 1200, perChipTHs: 0.75, perChipW: 17 },
    extreme: { freqMHz: 650, coreVoltageMV: 1250, perChipTHs: 0.90, perChipW: 20 },
  },
};

/** Famille de puce → profil pour un palier donné. */
export function resolveProfile(chip: ChipFamily, tier: OcTier): OcProfile {
  return PROFILES[chip][tier];
}

/** Tous les profils d'une puce, dans l'ordre des paliers. */
export function profilesForChip(chip: ChipFamily): Array<{ tier: OcTier; profile: OcProfile }> {
  return TIER_ORDER.map((tier) => ({ tier, profile: PROFILES[chip][tier] }));
}

/**
 * Déduit la famille de puce à partir du modèle ASIC (`ASICModel` AxeOS) ou,
 * à défaut, du nom de carte. Renvoie `generic` si rien ne correspond.
 */
export function detectChipFamily(opts: { chipType?: string; model?: string }): ChipFamily {
  const hay = `${opts.chipType || ''} ${opts.model || ''}`.toUpperCase();
  if (/BM1370/.test(hay)) return 'BM1370';
  if (/BM1368/.test(hay)) return 'BM1368';
  if (/BM1366/.test(hay)) return 'BM1366';
  if (/BM1397/.test(hay)) return 'BM1397';
  // Repli par nom de carte si la puce n'est pas exposée.
  if (/GAMMA|NERDQ?AXE\+\+|NERDOCTAXE|\bDUO\b|\bGT\b|\b60[12]\b|\b8\d{2}\b/.test(hay)) return 'BM1370';
  if (/SUPRA/.test(hay)) return 'BM1368';
  if (/ULTRA/.test(hay)) return 'BM1366';
  if (/\bMAX\b/.test(hay)) return 'BM1397';
  return 'generic';
}

/** Nombre de puces d'une carte (pour estimer le hashrate total). */
export function detectChipCount(model?: string): number {
  const hay = (model || '').toUpperCase();
  if (/NERDOCTAXE|OCTAXE/.test(hay)) return 8;
  if (/NERDQAXE\+\+|NERDQAXE\b/.test(hay)) return 4;
  if (/\bDUO\b|\bGT\b|\b650\b|\b801\b/.test(hay)) return 2;
  return 1;
}

/** Palier → workmode CGMiner/Avalon (équivalent ASIC, pas de freq/volt). */
export function tierToWorkmode(tier: OcTier): string {
  switch (tier) {
    case 'eco': return '0';
    case 'balanced': return '1';
    default: return '2'; // turbo + extreme → mode perf
  }
}

/** Efficacité énergétique (J/TH) — plus bas = mieux. */
export function efficiencyJTh(profile: OcProfile): number {
  if (profile.perChipTHs <= 0) return 0;
  return profile.perChipW / profile.perChipTHs;
}

/** Borne une valeur dans [min, max]. */
export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
