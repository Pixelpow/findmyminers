/**
 * GET /api/miner/export
 * Export telemetry history as CSV for a specific miner or the whole fleet.
 * Supports ?range=24h|7d|30d and ?format=csv
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { readTelemetry, getPointsForRange } from '@/server/telemetry-store';
import { readDashboardConfig } from '@/server/miner-config';
import { requireAuth } from '@/server/saas-auth';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const auth = await requireAuth(req, res);
  if (!auth) return;

  const orgId = auth.organization.id;
  const minerId = typeof req.query.minerId === 'string' ? req.query.minerId : undefined;
  const range = typeof req.query.range === 'string' ? req.query.range : '30d';

  try {
    const config = await readDashboardConfig(orgId);
    const miners = minerId
      ? config.miners.filter((m) => m.id === minerId)
      : config.miners.filter((m) => m.enabled);

    const rows: string[] = [];
    rows.push('timestamp,minerId,minerName,hashrateTHs,tempAvg,tempMax,powerW,accepted,rejected,stale,hardwareErrors,poolAlive,bestShare');

    for (const miner of miners) {
      const history = await readTelemetry(miner.id, orgId);
      const points = getPointsForRange(history, range);
      for (const p of points) {
        rows.push([
          new Date(p.ts).toISOString(),
          miner.id,
          `"${miner.name.replace(/"/g, '""')}"`,
          p.hashrateTHs.toFixed(4),
          p.tempAvg.toFixed(1),
          p.tempMax.toFixed(1),
          p.powerW.toFixed(0),
          p.accepted,
          p.rejected,
          p.stale,
          p.hardwareErrors,
          p.poolAlive ? 1 : 0,
          p.bestShare,
        ].join(','));
      }
    }

    const csv = rows.join('\n');
    const filename = minerId
      ? `telemetry-${minerId}-${range}.csv`
      : `telemetry-fleet-${range}.csv`;

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.status(200).send(csv);
  } catch (error: any) {
    return res.status(500).json({ error: error.message || 'Export failed' });
  }
}
