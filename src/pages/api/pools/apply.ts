/**
 * POST /api/pools/apply
 * Applique un pool (url + wallet/worker + mot de passe) à un ou plusieurs
 * mineurs de la flotte. Body: { minerIds: string[], pool: { url, user, pass? } }
 * → { results: [{ minerId, name, ok, queued?, error? }] }
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { requireAuth } from '@/server/saas-auth';
import { readDashboardConfig } from '@/server/miner-config';
import { executeMinerAction, isMinerActionSupported, unsupportedReason } from '@/server/miner-actions';

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
  const pool = body.pool || {};

  if (!minerIds.length) {
    return res.status(400).json({ error: 'minerIds[] requis' });
  }
  if (typeof pool.url !== 'string' || !pool.url.trim()) {
    return res.status(400).json({ error: 'pool.url requis' });
  }
  if (typeof pool.user !== 'string' || !pool.user.trim()) {
    return res.status(400).json({ error: 'pool.user (wallet.worker) requis' });
  }

  const value = JSON.stringify({
    url: pool.url.trim(),
    user: pool.user.trim(),
    pass: typeof pool.pass === 'string' && pool.pass ? pool.pass : 'x',
  });

  try {
    const config = await readDashboardConfig(orgId);
    const byId = new Map(config.miners.map((miner) => [miner.id, miner]));

    const results = await Promise.all(minerIds.map(async (minerId) => {
      const miner = byId.get(minerId);
      if (!miner) {
        return { minerId, name: minerId, ok: false, error: 'Mineur introuvable' };
      }
      if (!isMinerActionSupported(miner, 'setpool')) {
        return { minerId, name: miner.name, ok: false, error: unsupportedReason(miner, 'setpool') };
      }
      try {
        const outcome = await executeMinerAction({ miner, orgId, action: 'setpool', value });
        return { minerId, name: miner.name, ok: true, queued: outcome.queued || false };
      } catch (error) {
        return {
          minerId,
          name: miner.name,
          ok: false,
          error: error instanceof Error ? error.message : 'Échec de la reconfiguration',
        };
      }
    }));

    return res.status(200).json({ results });
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : 'Application du pool échouée' });
  }
}
