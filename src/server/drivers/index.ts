/**
 * Driver registry — the single entry point for talking to any miner.
 *
 * Discovery, fleet polling, the control endpoints and the agent all go through
 * here, so adding a new miner family is just: write a driver, append it to
 * `DRIVERS`. Nothing else changes.
 *
 * Order matters for detection: more specific TCP drivers (Antminer, Whatsminer)
 * are listed before the generic cgminer driver, which is the catch-all for any
 * remaining cgminer-API device (Avalon, etc.).
 */
import type { MinerNode } from '@/server/miner-config';
import { axeosDriver } from './axeos-driver';
import { antminerDriver } from './antminer-driver';
import { whatsminerDriver } from './whatsminer-driver';
import { cgminerDriver } from './cgminer-driver';
import type { DriverActionName, MinerCapability, MinerDriver, MinerIdentity, MinerProtocol, PollResult } from './types';

export * from './types';
export { normaliseName } from './device-names';

export const DRIVERS: MinerDriver[] = [
  axeosDriver,      // HTTP, port 80
  antminerDriver,   // TCP 4028, GH/s, specific
  whatsminerDriver, // TCP 4028, MH/s, specific
  cgminerDriver,    // TCP 4028, generic catch-all (Avalon + others)
];

/** All distinct ports any driver wants to probe (used by discovery). */
export const ALL_DRIVER_PORTS: number[] = Array.from(
  new Set(DRIVERS.flatMap((d) => d.ports)),
);

export function getDriver(protocol: MinerProtocol): MinerDriver | undefined {
  return DRIVERS.find((d) => d.protocol === protocol);
}

/**
 * Resolve the driver for a configured miner. Uses its stored `protocol`,
 * falling back to the generic cgminer driver for legacy configs.
 */
export function getDriverForMiner(miner: Pick<MinerNode, 'protocol'>): MinerDriver {
  if (miner.protocol) {
    const d = getDriver(miner.protocol);
    if (d) return d;
  }
  return cgminerDriver;
}

export function capabilitiesForProtocol(protocol?: MinerProtocol): MinerCapability[] {
  if (!protocol) return cgminerDriver.capabilities;
  return getDriver(protocol)?.capabilities ?? [];
}

export function isActionSupported(miner: Pick<MinerNode, 'protocol'>, action: DriverActionName): boolean {
  return getDriverForMiner(miner).capabilities.includes(action);
}

/**
 * Try to identify what kind of miner lives at `ip`.
 * Probes every driver on its declared ports; first match wins.
 * Returns the matched driver protocol + identity, or null.
 */
export async function identifyMiner(
  ip: string,
  timeoutMs = 700,
  openPorts?: Set<number>,
): Promise<(MinerIdentity & { label: string }) | null> {
  for (const driver of DRIVERS) {
    for (const port of driver.ports) {
      // If we already know which ports are open, skip the rest.
      if (openPorts && !openPorts.has(port)) continue;
      const identity = await driver.detect(ip, port, timeoutMs);
      if (identity) return { ...identity, label: driver.label };
    }
  }
  return null;
}

/**
 * Poll a configured miner using its known protocol. For legacy configs without
 * a protocol, falls back to trying cgminer then AxeOS (mirrors the old behaviour).
 */
export async function pollMiner(miner: Pick<MinerNode, 'ip' | 'port' | 'protocol'>): Promise<PollResult | null> {
  if (miner.protocol) {
    return getDriverForMiner(miner).poll(miner.ip, miner.port);
  }
  // Legacy fallback: CGMiner TCP first, then AxeOS HTTP.
  const cg = await cgminerDriver.poll(miner.ip, miner.port);
  if (cg) return cg;
  return axeosDriver.poll(miner.ip, 80);
}

/** Execute a control action on a configured miner via its driver. */
export async function controlMiner(
  miner: Pick<MinerNode, 'ip' | 'port' | 'protocol'>,
  action: DriverActionName,
  value?: string,
): Promise<void> {
  const driver = getDriverForMiner(miner);
  if (!driver.capabilities.includes(action)) {
    throw new Error(`Action "${action}" non supportée par le pilote ${driver.label}.`);
  }
  await driver.control(miner.ip, miner.port, action, value);
}
