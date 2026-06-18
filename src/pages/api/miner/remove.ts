/**
 * POST /api/miner/remove  { id }
 * Retire un mineur de la flotte (config). Idempotent : ok même si déjà absent.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { readDashboardConfig, updateDashboardConfig } from '@/server/miner-config';
import { requireAuth } from '@/server/saas-auth';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const auth = await requireAuth(req, res);
  if (!auth) return;
  const orgId = auth.organization.id;

  try {
    const id = typeof req.body?.id === 'string' ? req.body.id : '';
    if (!id) return res.status(400).json({ error: 'Identifiant de mineur requis.' });

    const config = await readDashboardConfig(orgId);
    const miner = config.miners.find((m) => m.id === id);
    if (!miner) return res.status(404).json({ error: 'Mineur introuvable dans la flotte.' });

    await updateDashboardConfig({ miners: config.miners.filter((m) => m.id !== id) }, orgId);

    return res.status(200).json({ ok: true, removed: { id: miner.id, name: miner.name } });
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : 'Suppression impossible' });
  }
}
