import type { NextApiRequest, NextApiResponse } from 'next';
import { readDashboardConfig } from '@/server/miner-config';
import { requireAuth } from '@/server/saas-auth';
import { executeMinerAction, isMinerActionSupported, unsupportedReason, type MinerActionName } from '@/server/miner-actions';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const auth = await requireAuth(req, res);
  if (!auth) return;

  const { action, value, minerIds } = req.body as {
    action?: MinerActionName;
    value?: string;
    minerIds?: string[];
  };

  if (!action || !Array.isArray(minerIds) || minerIds.length === 0) {
    return res.status(400).json({ error: 'Action and minerIds are required' });
  }

  const dashboardConfig = await readDashboardConfig(auth.organization.id);
  const miners = dashboardConfig.miners.filter((miner) => miner.enabled && minerIds.includes(miner.id));

  const results = await Promise.all(miners.map(async (miner) => {
    // Capability depends on each miner's driver, so check per miner.
    if (!isMinerActionSupported(miner, action)) {
      return {
        minerId: miner.id,
        minerName: miner.name,
        success: false,
        error: unsupportedReason(miner, action),
      };
    }

    try {
      const result = await executeMinerAction({
        miner,
        orgId: auth.organization.id,
        action,
        value: typeof value === 'string' ? value : undefined,
      });

      return {
        minerId: miner.id,
        minerName: miner.name,
        success: true,
        result,
      };
    } catch (error: unknown) {
      return {
        minerId: miner.id,
        minerName: miner.name,
        success: false,
        error: error instanceof Error ? error.message : 'Batch action failed',
      };
    }
  }));

  return res.status(200).json({
    action,
    requested: minerIds.length,
    matched: miners.length,
    successCount: results.filter((item) => item.success).length,
    failureCount: results.filter((item) => !item.success).length,
    results,
  });
}