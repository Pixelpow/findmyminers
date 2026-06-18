/**
 * Agent command queue.
 *
 * When the dashboard is hosted off-site (e.g. Vercel) it can't reach miners on
 * the user's LAN to control them. Instead, control actions for agent-managed
 * miners are queued here; the on-prem agent long-polls `/api/agent/commands`,
 * executes them locally, and acks the result. This is the command-return
 * channel that makes remote control possible without opening any inbound port.
 *
 * Backed by SQLite (single self-hosted instance). For multi-instance
 * deployments, point all instances at the same database / volume.
 */
import { randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';
import {
  insertAgentCommand,
  claimAgentCommands,
  ackAgentCommand,
  pruneAgentCommands,
  type AgentCommandRow,
} from '@/server/app-store-db';
import type { MinerNode } from '@/server/miner-config';

const DATA_DIR = path.join(process.cwd(), 'data');
const AGENT_ONLINE_WINDOW_MS = 90_000;

export type QueuedCommand = {
  id: string;
  minerId: string;
  minerIp: string;
  minerPort: number;
  protocol: string;
  action: string;
  value?: string;
};

/** Queue a control command for an agent-managed miner. Returns the command id. */
export function enqueueAgentCommand(orgId: string, miner: MinerNode, action: string, value?: string): string {
  const id = randomUUID();
  insertAgentCommand({
    id,
    org_id: orgId,
    agent_id: miner.agentId ?? null,
    miner_id: miner.id,
    miner_ip: miner.ip,
    miner_port: miner.port,
    protocol: miner.protocol || 'cgminer',
    action,
    value: value ?? null,
    created_at: Date.now(),
  });
  return id;
}

/** Claim pending commands for an agent (marks them as claimed). */
export function claimCommandsForAgent(orgId: string, agentId: string | null): QueuedCommand[] {
  pruneAgentCommands();
  const rows = claimAgentCommands(orgId, agentId, 25);
  return rows.map(toQueued);
}

export function acknowledgeCommand(orgId: string, id: string, success: boolean, error?: string): void {
  ackAgentCommand(orgId, id, success, error);
}

function toQueued(row: AgentCommandRow): QueuedCommand {
  return {
    id: row.id,
    minerId: row.miner_id,
    minerIp: row.miner_ip,
    minerPort: row.miner_port,
    protocol: row.protocol,
    action: row.action,
    value: row.value ?? undefined,
  };
}

/**
 * Return the id of a recently-seen agent for the org, or null if none is online.
 * Used to decide whether a control action can be relayed via an agent.
 */
export function getOnlineAgentId(orgId: string): string | null {
  try {
    const file = path.join(DATA_DIR, `agent-heartbeats-${orgId}.json`);
    if (!fs.existsSync(file)) return null;
    const store = JSON.parse(fs.readFileSync(file, 'utf-8')) as Record<string, { agentId: string; ts: number }>;
    const now = Date.now();
    const recent = Object.values(store)
      .filter((h) => now - (h.ts || 0) < AGENT_ONLINE_WINDOW_MS)
      .sort((a, b) => (b.ts || 0) - (a.ts || 0));
    return recent[0]?.agentId ?? null;
  } catch {
    return null;
  }
}

export function isAgentOnline(orgId: string): boolean {
  return getOnlineAgentId(orgId) !== null;
}
