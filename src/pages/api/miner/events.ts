import type { NextApiRequest, NextApiResponse } from 'next';
import { requireAuth } from '@/server/saas-auth';
import { readMinerEvents } from '@/server/event-history';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const auth = await requireAuth(req, res);
  if (!auth) return;

  const orgId = auth.organization.id;
  const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 100));
  const minerId = typeof req.query.minerId === 'string' ? req.query.minerId : undefined;
  const category = typeof req.query.category === 'string' ? req.query.category : undefined;

  try {
    let events = await readMinerEvents(orgId);

    if (minerId) {
      events = events.filter((event) => event.minerId === minerId);
    }

    if (category) {
      events = events.filter((event) => event.category === category);
    }

    const recent = events.slice(-limit).reverse();
    return res.status(200).json({ events: recent, total: events.length });
  } catch (error: any) {
    return res.status(500).json({ error: error.message || 'Failed to read miner events' });
  }
}