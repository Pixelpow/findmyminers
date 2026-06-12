import type { NextApiRequest, NextApiResponse } from 'next';
import { readDashboardConfig, updateDashboardConfig } from '@/server/miner-config';
import { requireAuth } from '@/server/saas-auth';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Demo mode: return empty config for GET
  if (process.env.DEMO_MODE === '1' && req.method === 'GET') {
    return res.status(200).json({ miners: [], nightMode: null, vacationMode: false, autoReboot: true, walletAddresses: [] });
  }

  const auth = await requireAuth(req, res);
  if (!auth) return;

  if (req.method === 'GET') {
    try {
      const config = await readDashboardConfig(auth.organization.id);
      return res.status(200).json(config);
    } catch (error: any) {
      return res.status(500).json({ error: error.message || 'Failed to read config' });
    }
  }

  if (req.method === 'POST') {
    try {
      const partial = req.body || {};

      // Reject unexpected top-level types
      if (typeof partial !== 'object' || Array.isArray(partial)) {
        return res.status(400).json({ error: 'Body must be a JSON object' });
      }

      // Validate miners array if present
      if (partial.miners !== undefined) {
        if (!Array.isArray(partial.miners)) {
          return res.status(400).json({ error: 'miners must be an array' });
        }
        const seenIds = new Set<string>();
        const seenIps = new Set<string>();
        for (const m of partial.miners) {
          if (typeof m.id !== 'string' || typeof m.ip !== 'string') {
            return res.status(400).json({ error: 'Each miner must have id and ip as strings' });
          }
          // Prevent duplicate IDs and IPs within the same request
          if (seenIds.has(m.id)) {
            return res.status(400).json({ error: `Duplicate miner ID: ${m.id}` });
          }
          if (seenIps.has(m.ip)) {
            return res.status(400).json({ error: `Duplicate miner IP: ${m.ip}` });
          }
          seenIds.add(m.id);
          seenIps.add(m.ip);
        }
      }

      const updated = await updateDashboardConfig(partial, auth.organization.id);
      return res.status(200).json(updated);
    } catch (error: any) {
      return res.status(500).json({ error: error.message || 'Failed to update config' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
