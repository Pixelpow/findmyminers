/**
 * POST /api/overclock/apply
 * Applique un palier d'overclock (ou un réglage manuel freq/voltage) à un ou
 * plusieurs mineurs. Body :
 *   { minerIds: string[], tier?: OcTier, custom?: { freqMHz, coreVoltageMV },
 *     fanPercent?: number, chipByMiner?: Record<minerId, chipType> }
 * → { results: [{ minerId, name, ok, applied?, queued?, error? }] }
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { requireAuth } from '@/server/saas-auth';
import { readDashboardConfig } from '@/server/miner-config';
import { applyOverclock } from '@/server/overclock-apply';
import { TIER_ORDER, type OcTier } from '@/lib/overclock';

const MAX_MINERS = 100;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const auth = await requireAuth(req, res);
  if (!auth) return;
  const orgId = auth.organization.id;

  const body = req.body || {};
  const minerIds: string[] = Array.isArray(body.minerIds)
    ? body.minerIds.filter((id: unknown): id is string => typeof id === 'string').slice(0, MAX_MINERS)
    : [];

  if (!minerIds.length) {
    return res.status(400).json({ error: 'minerIds[] requis' });
  }

  const tier: OcTier | undefined = TIER_ORDER.includes(body.tier) ? body.tier : undefined;
  const custom = body.custom && typeof body.custom === 'object'
    ? {
        freqMHz: Number(body.custom.freqMHz),
        coreVoltageMV: Number(body.custom.coreVoltageMV),
      }
    : undefined;

  if (!tier && (!custom || !Number.isFinite(custom.freqMHz) || !Number.isFinite(custom.coreVoltageMV))) {
    return res.status(400).json({ error: 'tier ou custom { freqMHz, coreVoltageMV } requis' });
  }

  const fanPercent = typeof body.fanPercent === 'number' && Number.isFinite(body.fanPercent)
    ? body.fanPercent
    : undefined;
  const chipByMiner: Record<string, string> = body.chipByMiner && typeof body.chipByMiner === 'object'
    ? body.chipByMiner
    : {};

  try {
    const config = await readDashboardConfig(orgId);
    const byId = new Map(config.miners.map((miner) => [miner.id, miner]));

    const results = await Promise.all(minerIds.map(async (minerId) => {
      const miner = byId.get(minerId);
      if (!miner) {
        return { minerId, name: minerId, ok: false, error: 'Mineur introuvable' };
      }
      const outcome = await applyOverclock({
        miner,
        orgId,
        tier,
        custom,
        fanPercent,
        chipType: chipByMiner[minerId],
      });
      return { minerId, name: miner.name, ...outcome };
    }));

    return res.status(200).json({ results });
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : 'Application overclock échouée' });
  }
}
