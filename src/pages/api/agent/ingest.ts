import type { NextApiRequest, NextApiResponse } from 'next';
import { appendTelemetry, readTelemetry, average, type MinerSnapshot } from '@/server/telemetry-store';
import { readDashboardConfig, updateDashboardConfig, type MinerNode } from '@/server/miner-config';
import { evaluateAndNotifyAlertsV2 } from '@/server/alerts';

function getAgentKey(req: NextApiRequest) {
  const header = req.headers['x-agent-key'];
  return typeof header === 'string' ? header : '';
}

function isValidSnapshot(snapshot: any): snapshot is MinerSnapshot {
  return Boolean(
    snapshot
      && Number.isFinite(snapshot.ts)
      && Number.isFinite(snapshot.hashrateTHs)
      && Number.isFinite(snapshot.tempAvg)
      && Number.isFinite(snapshot.tempMax)
      && Number.isFinite(snapshot.powerW)
      && Number.isFinite(snapshot.bestShare)
      && Number.isFinite(snapshot.lastDiff)
      && Number.isFinite(snapshot.diffAccepted)
      && Number.isFinite(snapshot.diffRejected)
      && Number.isFinite(snapshot.stale)
      && Number.isFinite(snapshot.rejected)
      && Number.isFinite(snapshot.accepted)
      && Number.isFinite(snapshot.hardwareErrors)
      && typeof snapshot.poolAlive === 'boolean',
  );
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const expectedKey = process.env.AGENT_SHARED_KEY;
  if (!expectedKey) {
    return res.status(503).json({ error: 'AGENT_SHARED_KEY is not configured on server' });
  }

  const providedKey = getAgentKey(req);
  if (!providedKey || providedKey !== expectedKey) {
    return res.status(401).json({ error: 'Invalid agent key' });
  }

  try {
    const body = req.body || {};
    const orgId = typeof body.orgId === 'string' && body.orgId.trim() ? body.orgId.trim() : 'public';
    const minerId = typeof body.minerId === 'string' && body.minerId.trim() ? body.minerId.trim() : '';
    const minerName = typeof body.minerName === 'string' && body.minerName.trim() ? body.minerName.trim() : minerId;
    const minerIp = typeof body.minerIp === 'string' ? body.minerIp.trim() : '';
    const minerPort = Number.isFinite(body.minerPort) ? Number(body.minerPort) : 4028;
    const protocol = body.protocol === 'axeos' || body.protocol === 'whatsminer' || body.protocol === 'antminer' ? body.protocol : 'cgminer';
    const agentId = typeof body.agentId === 'string' && body.agentId.trim() ? body.agentId.trim() : undefined;
    const snapshot = body.snapshot;

    if (!minerId) return res.status(400).json({ error: 'minerId is required' });
    if (!isValidSnapshot(snapshot)) return res.status(400).json({ error: 'Invalid snapshot payload' });

    const config = await readDashboardConfig(orgId);
    const existing = config.miners.find((miner) => miner.id === minerId);

    if (!existing) {
      const nextMiner: MinerNode = {
        id: minerId,
        name: minerName || minerId,
        ip: minerIp || '127.0.0.1',
        port: Number.isFinite(minerPort) ? minerPort : 4028,
        enabled: true,
        protocol,
        // Reached through the agent's LAN, so control is relayed via the agent.
        managedBy: 'agent',
        agentId,
      };

      await updateDashboardConfig(
        {
          miners: [...config.miners, nextMiner],
          selectedMinerId: config.selectedMinerId || nextMiner.id,
        },
        orgId,
      );
    }

    await appendTelemetry(minerId, snapshot, orgId);

    // Run alert evaluation on agent-ingested data
    try {
      const config = await readDashboardConfig(orgId);
      const miner = config.miners.find((m) => m.id === minerId) || { id: minerId, name: minerName || minerId, ip: minerIp || '', port: minerPort, enabled: true };
      const history = await readTelemetry(minerId, orgId);
      const recentWindow = history.slice(-24);
      const longWindow = history.slice(-200);
      const recentAvgHashrate = average(recentWindow.map((h) => h.hashrateTHs));
      const longAvgHashrate = average(longWindow.map((h) => h.hashrateTHs));
      await evaluateAndNotifyAlertsV2(snapshot, recentAvgHashrate, longAvgHashrate, config.alerts, miner, orgId);
    } catch {
      // Alert evaluation is best-effort; don't fail the ingest
    }

    return res.status(200).json({ ok: true, minerId, orgId });
  } catch (error: any) {
    return res.status(500).json({ error: error?.message || 'Agent ingest failed' });
  }
}
