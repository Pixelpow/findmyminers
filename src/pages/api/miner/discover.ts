import type { NextApiRequest, NextApiResponse } from 'next';
import { discoverMiners } from '@/server/discover-miners';
import { requireAuth } from '@/server/saas-auth';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const auth = await requireAuth(req, res);
  if (!auth) return;

  try {
    const body = req.body || {};
    const subnet = typeof body.subnet === 'string' ? body.subnet : undefined;
    const from = Number.isFinite(Number(body.from)) ? Number(body.from) : undefined;
    const to = Number.isFinite(Number(body.to)) ? Number(body.to) : undefined;
    const port = Number.isFinite(Number(body.port)) ? Number(body.port) : 4028;

    const miners = await discoverMiners({
      subnet,
      from,
      to,
      port,
    });

    return res.status(200).json({
      subnet: subnet || null,
      port,
      count: miners.length,
      miners,
    });
  } catch (error: any) {
    return res.status(500).json({ error: error.message || 'Discovery failed' });
  }
}
