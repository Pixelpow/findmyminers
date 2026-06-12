/**
 * POST /api/miner/scan
 * Server-side agentless network scan: discovers miners on the local network
 * and optionally auto-adds them to the config.
 * No agent required — the dashboard server itself scans the subnet.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { discoverMiners, type DiscoveredMiner } from '@/server/discover-miners';
import { readDashboardConfig, updateDashboardConfig, type MinerNode } from '@/server/miner-config';
import { requireAuth } from '@/server/saas-auth';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const auth = await requireAuth(req, res);
  if (!auth) return;

  const orgId = auth.organization.id;

  try {
    const body = req.body || {};
    const subnet = typeof body.subnet === 'string' ? body.subnet.trim() : undefined;
    const autoAdd = body.autoAdd === true;

    const miners = await discoverMiners({ subnet, timeoutMs: 1200, concurrency: 36 });

    if (autoAdd && miners.length > 0) {
      const config = await readDashboardConfig(orgId);
      // Prevent adding miners with duplicate IP or ID (both must be unique).
      const existingIps = new Set(config.miners.map((m) => m.ip));
      const existingIds = new Set(config.miners.map((m) => m.id));

      const newMiners: MinerNode[] = miners
        .filter((m) => !existingIps.has(m.ip) && !existingIds.has(m.id))
        .map((m) => ({
          id: m.id,
          name: m.name || m.model || `Miner ${m.ip}`,
          ip: m.ip,
          port: m.port,
          enabled: true,
          model: m.model,
          protocol: m.protocol,
        }));

      if (newMiners.length > 0) {
        await updateDashboardConfig({
          miners: [...config.miners, ...newMiners],
        }, orgId);
      }

      return res.status(200).json({
        discovered: miners.length,
        added: newMiners.length,
        alreadyKnown: miners.length - newMiners.length,
        message: newMiners.length > 0 ? `Added ${newMiners.length} new miner(s)` : 'All found miners were already added.',
        miners,
      });
    }

    return res.status(200).json({
      discovered: miners.length,
      miners,
    });
  } catch (error: any) {
    return res.status(500).json({ error: error.message || 'Scan failed' });
  }
}
