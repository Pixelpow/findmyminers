import type { NextApiRequest, NextApiResponse } from 'next';
import { readDashboardConfig } from '@/server/miner-config';
import { requireAuth } from '@/server/saas-auth';
import { identifyMiner } from '@/server/identify-miner';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const auth = await requireAuth(req, res);
  if (!auth) return;

  try {
    const { id } = req.query;
    const { action } = req.body;

    if (!id || typeof id !== 'string') {
      return res.status(400).json({ error: 'Miner ID required' });
    }

    if (action !== 'restart') {
      return res.status(400).json({ error: 'Invalid action' });
    }

    const config = await readDashboardConfig(auth.organization.id);
    const miner = config.miners.find((m) => m.id === id);

    if (!miner || !miner.enabled) {
      return res.status(404).json({ error: 'Miner not found or disabled' });
    }

    const identified = await identifyMiner(miner.ip, miner.port);
    if (!identified.online) {
      return res.status(503).json({ error: 'Miner is offline' });
    }

    const protocol = identified.protocol || miner.protocol || 'cgminer';

    if (protocol === 'axeos') {
      const response = await fetch(`http://${miner.ip}/api/system/reboot`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        timeout: 3000,
      });
      if (!response.ok) {
        throw new Error(`AxeOS reboot failed: ${response.status}`);
      }
    } else if (protocol === 'cgminer') {
      const socket = require('net').createConnection(miner.port || 4028, miner.ip);
      socket.write(JSON.stringify({ command: 'restart' }) + '\n');
      socket.destroy();
    } else {
      return res.status(501).json({ error: `Restart not supported for ${protocol}` });
    }

    return res.status(200).json({ success: true, message: 'Restart signal sent' });
  } catch (error: any) {
    console.error(`Restart failed: ${error.message}`);
    return res.status(500).json({ error: error.message || 'Failed to send restart signal' });
  }
}
