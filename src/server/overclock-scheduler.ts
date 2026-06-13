/**
 * Planificateur d'overclock côté serveur.
 *
 * Comme l'auto-reboot, l'application est déclenchée DEPUIS le poll fleet
 * (`buildFleetPayload`) : pas de cron séparé, donc actif même navigateur fermé
 * tant que le serveur tourne. Un garde par organisation évite de re-pousser les
 * réglages à chaque poll — on n'applique que sur changement de palier.
 */
import type { MinerNode, OcSchedule, OcTier } from '@/server/miner-config';
import { applyOverclock } from '@/server/overclock-apply';
import { appendMinerEvent } from '@/server/event-history';
import { TIER_META } from '@/lib/overclock';

export type ActiveTier = {
  tier: OcTier;
  label: string;
  fanPercent?: number;
  source: 'window' | 'default';
};

/** Palier actuellement actif selon l'heure/le jour (null si planning désactivé). */
export function activeTierForSchedule(schedule: OcSchedule | undefined, now = new Date()): ActiveTier | null {
  if (!schedule?.enabled) return null;
  const hour = now.getHours();
  const day = now.getDay(); // 0 = dimanche

  for (const w of schedule.windows || []) {
    const dayOk = !w.days || w.days.length === 0 || w.days.includes(day);
    if (!dayOk) continue;
    const inWindow = w.startHour === w.endHour
      ? true // créneau couvrant 24 h
      : w.startHour < w.endHour
        ? hour >= w.startHour && hour < w.endHour
        : hour >= w.startHour || hour < w.endHour; // passe minuit
    if (inWindow) {
      return {
        tier: w.tier,
        label: w.label || TIER_META[w.tier].label,
        fanPercent: w.fanPercent,
        source: 'window',
      };
    }
  }

  return { tier: schedule.defaultTier, label: 'Hors créneau', source: 'default' };
}

/** Dernier palier réellement appliqué par organisation (anti-répétition). */
const lastApplied = new Map<string, string>();

/**
 * Applique le palier actif à toute la flotte SI il a changé depuis le dernier
 * passage. Conçu pour être appelé sans `await` depuis le poll fleet.
 */
export async function enforceOcSchedule(args: {
  orgId: string;
  schedule?: OcSchedule;
  miners: MinerNode[];
  chipByMiner?: Record<string, string>;
}): Promise<void> {
  const active = activeTierForSchedule(args.schedule);
  if (!active) return;

  const signature = `${active.tier}|${active.fanPercent ?? ''}`;
  if (lastApplied.get(args.orgId) === signature) return;
  lastApplied.set(args.orgId, signature);

  for (const miner of args.miners) {
    try {
      const outcome = await applyOverclock({
        miner,
        orgId: args.orgId,
        tier: active.tier,
        fanPercent: active.fanPercent,
        chipType: args.chipByMiner?.[miner.id],
      });
      if (outcome.ok) {
        await appendMinerEvent({
          ts: Date.now(),
          type: 'oc-schedule',
          category: 'action',
          severity: 'info',
          minerId: miner.id,
          minerName: miner.name,
          message: `Planification overclock : palier ${TIER_META[active.tier].label}${outcome.applied ? ` (${outcome.applied})` : ''}`,
        }, args.orgId, {
          dedupeKey: `${miner.id}:oc-schedule:${signature}`,
          dedupeWindowMs: 60_000,
        });
      }
    } catch {
      // Un échec mineur ne doit pas bloquer le reste de la flotte.
    }
  }
}
