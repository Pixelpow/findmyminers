import type { NextApiRequest, NextApiResponse } from 'next';
import { requireAuth } from '@/server/saas-auth';
import { readHallOfFame } from '@/server/miner-diff-db';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const auth = await requireAuth(req, res);
  if (!auth) return;

  try {
    const limit = Math.min(25, Math.max(5, Number(req.query.limit) || 10));
    const data = readHallOfFame(auth.organization.id, limit);
    return res.status(200).json(data);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to load records';
    return res.status(500).json({ error: message });
  }
}