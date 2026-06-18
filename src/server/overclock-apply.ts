/**
 * Application d'un palier (ou d'un réglage manuel) d'overclock à UN mineur.
 *
 * - AxeOS (capacités `frequency` + `voltage`) : on règle la tension PUIS la
 *   fréquence (on garantit la marge de tension avant de monter l'horloge).
 * - CGMiner / Avalon (capacité `mode`) : on bascule le `workmode` équivalent.
 * - Si un pourcentage de ventilation est fourni et supporté, on l'applique aussi.
 *
 * Partagé entre l'API `/api/overclock/apply` et le scheduler serveur.
 */
import type { MinerNode } from '@/server/miner-config';
import { executeMinerAction, isMinerActionSupported, unsupportedReason } from '@/server/miner-actions';
import {
  type OcTier,
  CHIP_FREQ_RANGE,
  CHIP_MAX_VOLTAGE,
  VOLTAGE_MIN_MV,
  clamp,
  detectChipFamily,
  resolveProfile,
  tierToWorkmode,
} from '@/lib/overclock';

export type OverclockTarget = {
  tier?: OcTier;
  custom?: { freqMHz: number; coreVoltageMV: number };
  fanPercent?: number;
  /** Type de puce ASIC remonté par le poll (ex. "BM1370"), plus fiable que le modèle. */
  chipType?: string;
};

export type OverclockOutcome = {
  ok: boolean;
  /** Résumé lisible de ce qui a été appliqué (ex. « 600 MHz / 1200 mV »). */
  applied?: string;
  queued?: boolean;
  error?: string;
};

export async function applyOverclock(args: { miner: MinerNode; orgId: string } & OverclockTarget): Promise<OverclockOutcome> {
  const { miner, orgId, tier, custom, fanPercent, chipType } = args;

  const supportsFreq = isMinerActionSupported(miner, 'frequency') && isMinerActionSupported(miner, 'voltage');
  const supportsMode = isMinerActionSupported(miner, 'mode');

  try {
    let applied = '';
    let queued = false;

    if (supportsFreq) {
      const chip = detectChipFamily({ chipType, model: miner.model });
      const range = CHIP_FREQ_RANGE[chip];
      let freqMHz: number;
      let coreVoltageMV: number;
      if (custom) {
        freqMHz = clamp(Math.round(custom.freqMHz), range.min, range.max);
        coreVoltageMV = clamp(Math.round(custom.coreVoltageMV), VOLTAGE_MIN_MV, CHIP_MAX_VOLTAGE[chip]);
      } else {
        const profile = resolveProfile(chip, tier || 'balanced');
        freqMHz = profile.freqMHz;
        // Garde-fou : ne jamais dépasser la limite 24/7 de la puce.
        coreVoltageMV = clamp(profile.coreVoltageMV, VOLTAGE_MIN_MV, CHIP_MAX_VOLTAGE[chip]);
      }
      // Tension d'abord (marge), puis fréquence.
      const v = await executeMinerAction({ miner, orgId, action: 'voltage', value: String(coreVoltageMV) });
      const f = await executeMinerAction({ miner, orgId, action: 'frequency', value: String(freqMHz) });
      queued = Boolean(v.queued || f.queued);
      applied = `${freqMHz} MHz / ${coreVoltageMV} mV`;
    } else if (supportsMode) {
      // Pas de réglage freq/volt direct : on mappe le palier sur le workmode.
      const workmode = tierToWorkmode(tier || 'balanced');
      const m = await executeMinerAction({ miner, orgId, action: 'mode', value: workmode });
      queued = Boolean(m.queued);
      applied = `mode ${workmode === '0' ? 'éco' : workmode === '2' ? 'perf' : 'normal'}`;
    } else {
      return { ok: false, error: unsupportedReason(miner, 'frequency') };
    }

    // Ventilation optionnelle (absorbe le réglage de l'ancien mode nuit).
    if (typeof fanPercent === 'number' && Number.isFinite(fanPercent) && isMinerActionSupported(miner, 'fan')) {
      const fan = await executeMinerAction({ miner, orgId, action: 'fan', value: String(clamp(Math.round(fanPercent), 0, 100)) });
      queued = queued || Boolean(fan.queued);
      applied += ` · ventilo ${clamp(Math.round(fanPercent), 0, 100)}%`;
    }

    return { ok: true, applied, queued };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Application overclock échouée' };
  }
}
