/**
 * Agent command channel.
 *
 *  GET  /api/agent/commands?orgId=&agentId=&wait=1
 *       The on-prem agent long-polls (up to ~25s) for control commands to run.
 *       Returns claimed commands; the agent executes them locally and acks.
 *
 *  POST /api/agent/commands   { commandId, success, error? }
 *       Agent reports the result of an executed command.
 *
 * Authenticated with the shared agent key (same as ingest/heartbeat).
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { claimCommandsForAgent, acknowledgeCommand } from '@/server/command-queue';

const LONG_POLL_MAX_MS = 25_000;
const POLL_INTERVAL_MS = 1_000;

function checkAgentKey(req: NextApiRequest, res: NextApiResponse): boolean {
  const expectedKey = process.env.AGENT_SHARED_KEY;
  if (!expectedKey) {
    res.status(503).json({ error: 'AGENT_SHARED_KEY not configured' });
    return false;
  }
  const provided = typeof req.headers['x-agent-key'] === 'string' ? req.headers['x-agent-key'] : '';
  if (!provided || provided !== expectedKey) {
    res.status(401).json({ error: 'Invalid agent key' });
    return false;
  }
  return true;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!checkAgentKey(req, res)) return;

  if (req.method === 'GET') {
    const orgId = (typeof req.query.orgId === 'string' && req.query.orgId.trim()) ? req.query.orgId.trim() : 'public';
    const agentId = typeof req.query.agentId === 'string' && req.query.agentId.trim() ? req.query.agentId.trim() : null;
    const wait = req.query.wait === '1' || req.query.wait === 'true';

    const deadline = Date.now() + LONG_POLL_MAX_MS;
    do {
      const commands = claimCommandsForAgent(orgId, agentId);
      if (commands.length || !wait || Date.now() >= deadline) {
        return res.status(200).json({ commands });
      }
      await sleep(POLL_INTERVAL_MS);
    } while (true);
  }

  if (req.method === 'POST') {
    const body = req.body || {};
    const orgId = typeof body.orgId === 'string' && body.orgId.trim() ? body.orgId.trim() : 'public';
    const commandId = typeof body.commandId === 'string' ? body.commandId : '';
    if (!commandId) return res.status(400).json({ error: 'commandId is required' });
    acknowledgeCommand(orgId, commandId, body.success === true, typeof body.error === 'string' ? body.error : undefined);
    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
