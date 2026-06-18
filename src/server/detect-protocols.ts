/**
 * One-time protocol backfill.
 *
 * Miners added before drivers existed have no stored `protocol`, so they fall
 * back to the generic cgminer driver — wrong badge and wrong control path for
 * AxeOS/Bitaxe devices. This probes such miners through the driver registry
 * (which prefers AxeOS HTTP over cgminer TCP) and persists the detected
 * protocol so it only ever happens once per miner.
 */
import { identifyMiner } from '@/server/drivers';
import { readDashboardConfig, updateDashboardConfig, type MinerNode } from '@/server/miner-config';

// Avoid re-probing the same miner every poll (e.g. one that stays offline).
const attempted = new Set<string>();

export async function ensureMinerProtocols(orgId: string, miners: MinerNode[]): Promise<MinerNode[]> {
  const todo = miners.filter((m) => m.enabled && !m.protocol && !attempted.has(`${orgId}:${m.id}`));
  if (!todo.length) return miners;

  const detected = await Promise.all(todo.map(async (m) => {
    attempted.add(`${orgId}:${m.id}`);
    const identity = await identifyMiner(m.ip, 800).catch(() => null);
    return { id: m.id, protocol: identity?.protocol, port: identity?.port };
  }));

  const updates = new Map(detected.filter((d) => d.protocol).map((d) => [d.id, { protocol: d.protocol!, port: d.port }]));
  if (!updates.size) return miners;

  // Persist protocol + the port the driver actually answered on (e.g. 80 for AxeOS).
  const apply = (m: MinerNode): MinerNode => {
    const u = updates.get(m.id);
    return u ? { ...m, protocol: u.protocol, port: u.port ?? m.port } : m;
  };

  // Re-read before writing so we don't clobber concurrent config changes.
  const config = await readDashboardConfig(orgId);
  await updateDashboardConfig({ miners: config.miners.map(apply) }, orgId);

  return miners.map(apply);
}
