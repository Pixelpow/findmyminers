import type { NextApiRequest, NextApiResponse } from 'next';
import { average, getPointsForRange, readTelemetry } from '@/server/telemetry-store';
import { resolveMinerId } from '@/server/miner-config';
import { requireAuth } from '@/server/saas-auth';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const auth = await requireAuth(req, res);
  if (!auth) return;

  try {
    const range = typeof req.query.range === 'string' ? req.query.range : '24h';
    const compareRange = typeof req.query.compareRange === 'string' ? req.query.compareRange : '7d';
    const minerId = await resolveMinerId(typeof req.query.minerId === 'string' ? req.query.minerId : undefined, auth.organization.id);

    const all = await readTelemetry(minerId, auth.organization.id);
    const points = getPointsForRange(all, range);
    const comparePoints = getPointsForRange(all, compareRange);

    const avgHashrate = average(points.map((point) => point.hashrateTHs));
    const avgTemp = average(points.map((point) => point.tempAvg));
    const avgPower = average(points.map((point) => point.powerW));
    const rejectedTotal = points.reduce((sum, point) => sum + point.rejected, 0);
    const acceptedTotal = points.reduce((sum, point) => sum + point.accepted, 0);
    const staleTotal = points.reduce((sum, point) => sum + point.stale, 0);

    const uptimeRatio = points.length
      ? points.filter((point) => point.poolAlive).length / points.length
      : 0;

    const compareAvgHashrate = average(comparePoints.map((point) => point.hashrateTHs));
    const compareAvgTemp = average(comparePoints.map((point) => point.tempAvg));

    res.status(200).json({
      minerId,
      range,
      compareRange,
      points,
      stats: {
        avgHashrate,
        avgTemp,
        avgPower,
        rejectedTotal,
        acceptedTotal,
        staleTotal,
        uptimeRatio,
        compareAvgHashrate,
        compareAvgTemp,
      },
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to read history' });
  }
}
