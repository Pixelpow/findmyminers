import type { NextApiRequest, NextApiResponse } from 'next';
import fs from 'fs/promises';
import path from 'path';

type AgentHeartbeat = {
  agentId: string;
  version: string;
  hostname: string;
  platform?: string;
  latestVersion?: string;
  updateAvailable?: boolean;
  lastScanAt: number;
  minersDetected: number;
  uptimeSeconds: number;
  ts: number;
};

const DATA_DIR = path.join(process.cwd(), 'data');

function heartbeatFile(orgId: string) {
  return path.join(DATA_DIR, `agent-heartbeats-${orgId}.json`);
}

async function ensureFile(orgId: string) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  const file = heartbeatFile(orgId);
  try {
    await fs.access(file);
  } catch {
    await fs.writeFile(file, '{}', 'utf-8');
  }
}

/**
 * POST /api/agent/heartbeat — Agent reports its status
 * GET  /api/agent/heartbeat — Dashboard reads agent statuses
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'POST') {
    const expectedKey = process.env.AGENT_SHARED_KEY;
    if (!expectedKey) {
      return res.status(503).json({ error: 'AGENT_SHARED_KEY not configured' });
    }
    const providedKey = typeof req.headers['x-agent-key'] === 'string' ? req.headers['x-agent-key'] : '';
    if (!providedKey || providedKey !== expectedKey) {
      return res.status(401).json({ error: 'Invalid agent key' });
    }

    const body = req.body || {};
    const orgId = typeof body.orgId === 'string' && body.orgId.trim() ? body.orgId.trim() : 'public';
    const agentId = typeof body.agentId === 'string' && body.agentId.trim() ? body.agentId.trim() : 'default';

    const heartbeat: AgentHeartbeat = {
      agentId,
      version: typeof body.version === 'string' ? body.version : 'unknown',
      hostname: typeof body.hostname === 'string' ? body.hostname : 'unknown',
      platform: typeof body.platform === 'string' ? body.platform : undefined,
      latestVersion: typeof body.latestVersion === 'string' ? body.latestVersion : undefined,
      updateAvailable: body.updateAvailable === true,
      lastScanAt: Number.isFinite(body.lastScanAt) ? body.lastScanAt : 0,
      minersDetected: Number.isFinite(body.minersDetected) ? body.minersDetected : 0,
      uptimeSeconds: Number.isFinite(body.uptimeSeconds) ? body.uptimeSeconds : 0,
      ts: Date.now(),
    };

    await ensureFile(orgId);
    const file = heartbeatFile(orgId);
    let store: Record<string, AgentHeartbeat> = {};
    try {
      store = JSON.parse(await fs.readFile(file, 'utf-8'));
    } catch { /* empty */ }

    store[agentId] = heartbeat;
    await fs.writeFile(file, JSON.stringify(store, null, 2), 'utf-8');

    return res.status(200).json({ ok: true });
  }

  if (req.method === 'GET') {
    // Requires auth for reading
    const { requireAuth } = await import('@/server/saas-auth');
    const auth = await requireAuth(req, res);
    if (!auth) return;

    const orgId = auth.organization.id;
    await ensureFile(orgId);

    try {
      const store = JSON.parse(await fs.readFile(heartbeatFile(orgId), 'utf-8'));
      const agents = Object.values(store) as AgentHeartbeat[];
      return res.status(200).json({ agents });
    } catch {
      return res.status(200).json({ agents: [] });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
