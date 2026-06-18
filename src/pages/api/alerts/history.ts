import type { NextApiRequest, NextApiResponse } from 'next';
import { requireAuth } from '@/server/saas-auth';
import { readAlertHistory } from '@/server/alert-history';

/**
 * GET /api/alerts/history
 * Returns the alert history for the authenticated org.
 * Optional query params: limit (default 200), type (filter by alert type)
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Demo mode: return mock alert data
  if (process.env.DEMO_MODE === '1') {
    const { DEMO_ALERTS } = await import('@/server/demo-data');
    return res.status(200).json(DEMO_ALERTS);
  }

  const auth = await requireAuth(req, res);
  if (!auth) return;

  const orgId = auth.organization.id;
  const limit = Math.min(1000, Math.max(1, Number(req.query.limit) || 200));
  const typeFilter = typeof req.query.type === 'string' ? req.query.type : undefined;

  try {
    let events = await readAlertHistory(orgId);

    if (typeFilter) {
      events = events.filter((e) => e.type === typeFilter);
    }

    // Return most recent first
    const recent = events.slice(-limit).reverse();

    return res.status(200).json({ events: recent, total: events.length });
  } catch (error: any) {
    return res.status(500).json({ error: error.message || 'Failed to read alert history' });
  }
}
