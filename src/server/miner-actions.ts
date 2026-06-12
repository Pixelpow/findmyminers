/**
 * High-level miner control.
 *
 * Routes an action to the right driver (via the registry), or — when the miner
 * is agent-managed and unreachable from the server — queues it for the on-prem
 * agent to execute. Every action is recorded in the event history.
 */
import { controlMiner, isActionSupported, getDriverForMiner, type DriverActionName } from '@/server/drivers';
import type { MinerNode } from '@/server/miner-config';
import { appendMinerEvent } from '@/server/event-history';
import { enqueueAgentCommand } from '@/server/command-queue';

/** Action names accepted by the control endpoints (= driver capabilities). */
export type MinerActionName = DriverActionName;

/** Whether a given miner's driver can perform an action. */
export function isMinerActionSupported(miner: Pick<MinerNode, 'protocol'>, action: MinerActionName): boolean {
  return isActionSupported(miner, action);
}

export function unsupportedReason(miner: Pick<MinerNode, 'protocol'>, action: MinerActionName): string {
  return `Action "${action}" non supportée par le pilote ${getDriverForMiner(miner).label}.`;
}

export function controlMessage(action: MinerActionName, value?: string): string {
  switch (action) {
    case 'fan':
      return `Fan speed set to ${value ?? 'custom'}%.`;
    case 'mode':
      return `Performance mode changed to ${value === '0' ? 'low' : value === '2' ? 'high' : 'normal'}.`;
    case 'target-temp':
      return `Target temperature set to ${value ?? 'unknown'}°C.`;
    case 'smart-speed':
      return `Smart fan control ${value === '1' ? 'enabled' : 'disabled'}.`;
    case 'switchpool':
      return `Pool switch requested to slot ${value ?? 'unknown'}.`;
    case 'setpool': {
      try {
        const pool = JSON.parse(value || '{}') as { url?: string };
        return `Pool reconfiguré vers ${pool.url || 'endpoint inconnu'}.`;
      } catch {
        return 'Pool reconfiguré.';
      }
    }
    case 'frequency':
      return `Frequency set to ${value ?? 'unknown'} MHz.`;
    case 'voltage':
      return `Core voltage set to ${value ?? 'unknown'} mV.`;
    case 'led':
      return 'LED toggled.';
    case 'reboot':
      return 'Miner reboot requested.';
    default:
      return `Control action ${action} executed.`;
  }
}

export async function executeMinerAction(args: {
  miner: MinerNode;
  orgId: string;
  action: MinerActionName;
  value?: string;
}): Promise<{ ok: true; queued?: boolean; commandId?: string }> {
  const { miner, orgId, action, value } = args;

  if (!isActionSupported(miner, action)) {
    throw new Error(unsupportedReason(miner, action));
  }

  // Agent-managed miners: queue the command for the on-prem agent instead of
  // trying (and failing) to reach the LAN directly from the server.
  if (miner.managedBy === 'agent') {
    const commandId = enqueueAgentCommand(orgId, miner, action, value);
    await appendMinerEvent({
      ts: Date.now(),
      type: `control-${action}`,
      category: 'action',
      severity: action === 'reboot' ? 'warning' : 'info',
      minerId: miner.id,
      minerName: miner.name,
      message: `${controlMessage(action, value)} (queued for agent)`,
      metadata: value ? { value } : undefined,
    }, orgId, {
      dedupeKey: `${miner.id}:control:${action}:${value || ''}`,
      dedupeWindowMs: 5_000,
    });
    return { ok: true, queued: true, commandId };
  }

  await controlMiner(miner, action, value);

  await appendMinerEvent({
    ts: Date.now(),
    type: `control-${action}`,
    category: 'action',
    severity: action === 'reboot' ? 'warning' : 'info',
    minerId: miner.id,
    minerName: miner.name,
    message: controlMessage(action, value),
    metadata: value ? { value } : undefined,
  }, orgId, {
    dedupeKey: `${miner.id}:control:${action}:${value || ''}`,
    dedupeWindowMs: 5_000,
  });

  return { ok: true };
}
