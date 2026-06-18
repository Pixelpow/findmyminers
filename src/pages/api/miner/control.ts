import { NextApiRequest, NextApiResponse } from 'next';
import { getMinerById } from '@/server/miner-config';
import { requireAuth } from '@/server/saas-auth';
import { executeMinerAction, isMinerActionSupported, unsupportedReason, type MinerActionName } from '@/server/miner-actions';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const auth = await requireAuth(req, res);
    if (!auth) return;

    const { action, value, minerId } = req.body as { action?: MinerActionName; value?: string; minerId?: string };

    if (!action) {
        return res.status(400).json({ error: 'Action is required' });
    }

    try {
        const miner = await getMinerById(typeof minerId === 'string' ? minerId : undefined, auth.organization.id);

        if (!isMinerActionSupported(miner, action)) {
          return res.status(400).json({ error: unsupportedReason(miner, action), action });
        }

        const result = await executeMinerAction({
          miner,
          orgId: auth.organization.id,
          action,
          value: typeof value === 'string' ? value : undefined,
        });

        res.status(200).json({ success: true, miner, result });
    } catch (error: unknown) {
        res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to send command' });
    }
}
