import type { NextApiRequest, NextApiResponse } from 'next';
import { requireAuth } from '@/server/saas-auth';
import { readDashboardConfig, writeDashboardConfig } from '@/server/miner-config';

/**
 * POST /api/miner/maintenance
 * Record a maintenance event for a specific miner.
 * Body: { minerId: string }
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const auth = await requireAuth(req, res);
  if (!auth) return;
  const orgId = auth.organization.id;

  const { minerId } = req.body || {};
  if (!minerId || typeof minerId !== 'string') {
    return res.status(400).json({ error: 'Missing minerId' });
  }

  const config = await readDashboardConfig(orgId);
  const minerIndex = config.miners.findIndex((m) => m.id === minerId);
  if (minerIndex === -1) {
    return res.status(404).json({ error: 'Miner not found' });
  }

  config.miners[minerIndex].lastMaintenanceTs = Date.now();
  await writeDashboardConfig(config, orgId);

  return res.status(200).json({ ok: true, lastMaintenanceTs: config.miners[minerIndex].lastMaintenanceTs });
}
