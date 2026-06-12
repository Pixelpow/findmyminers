/**
 * Network discovery.
 *
 * Thin orchestrator on top of the driver registry:
 *   1. (optional) mDNS hints for instant Bitaxe/AxeOS detection
 *   2. fast TCP port-knock to find live hosts across one or more subnets
 *   3. driver `identify()` + `poll()` to confirm and enrich each hit
 *
 * All protocol knowledge lives in the drivers (src/server/drivers/*), so this
 * file never has to change when a new miner family is added.
 *
 * `normaliseName` is re-exported here for backward compatibility — its real
 * home is now `src/server/drivers/device-names.ts`.
 */
import { identifyMiner, getDriver, ALL_DRIVER_PORTS, type MinerProtocol } from '@/server/drivers';
import { findOpenHosts, getLocalSubnets, getDefaultSubnet, type OpenHostMap } from '@/server/discovery/prescan';
import { discoverViaMdns } from '@/server/discovery/mdns';

export { normaliseName } from '@/server/drivers/device-names';

type DiscoveryOptions = {
  subnet?: string;
  subnets?: string[];
  from?: number;
  to?: number;
  port?: number;
  timeoutMs?: number;
  concurrency?: number;
  /** Set false to skip the mDNS hint pass (defaults to true). */
  mdns?: boolean;
};

export type DiscoveredMiner = {
  id: string;
  name: string;
  ip: string;
  port: number;
  enabled: boolean;
  model?: string;
  firmware?: string;
  source?: MinerProtocol;
  protocol?: MinerProtocol;
  hashrateTHs?: number;
  tempC?: number;
  powerW?: number;
  description?: string;
  deviceType?: 'asic' | 'bitaxe' | 'unknown';
  chipType?: string;
  fanRpm?: number;
  uptime?: number;
  accepted?: number;
  rejected?: number;
  poolUrl?: string;
};

/** Identify + poll a single live host. Returns null if no driver claims it. */
async function probeHost(ip: string, openPorts: Set<number> | undefined, timeoutMs: number): Promise<DiscoveredMiner | null> {
  const identity = await identifyMiner(ip, timeoutMs, openPorts);
  if (!identity) return null;

  const driver = getDriver(identity.protocol);
  const live = driver ? await driver.poll(ip, identity.port, Math.max(timeoutMs, 1500)).catch(() => null) : null;

  const prefix = identity.deviceType === 'bitaxe' ? 'bitaxe' : identity.protocol;
  const tail = ip.split('.').pop() || 'x';

  return {
    id: `${prefix}-${tail}`,
    name: (live?.model || identity.model || identity.protocol).replace(/\s+/g, ' ').trim(),
    ip,
    port: identity.port,
    enabled: true,
    model: live?.model || identity.model,
    firmware: live?.firmware || identity.firmware,
    source: identity.protocol,
    protocol: identity.protocol,
    deviceType: identity.deviceType,
    chipType: live?.chipType || identity.chipType,
    hashrateTHs: live?.snapshot.hashrateTHs || undefined,
    tempC: live?.snapshot.tempAvg || undefined,
    powerW: live?.snapshot.powerW || undefined,
    fanRpm: live?.fanRpm,
    uptime: live?.uptime,
    accepted: live?.snapshot.accepted || undefined,
    rejected: live?.snapshot.rejected || undefined,
    poolUrl: live?.poolUrl || undefined,
  };
}

export async function discoverMiners(options: DiscoveryOptions = {}): Promise<DiscoveredMiner[]> {
  const from = Math.max(1, Math.min(254, options.from ?? 1));
  const to = Math.max(from, Math.min(254, options.to ?? 254));
  const timeoutMs = options.timeoutMs ?? 700;
  const concurrency = Math.max(1, Math.min(256, options.concurrency ?? 128));

  // Which subnets to sweep: explicit > list > all local interfaces.
  const subnets = options.subnet
    ? [options.subnet]
    : (options.subnets && options.subnets.length ? options.subnets : getLocalSubnets());
  if (subnets.length === 0) subnets.push(getDefaultSubnet());

  // Ports to knock: the caller-provided one plus every driver's declared ports.
  const knockPorts = Array.from(new Set([...(options.port ? [options.port] : []), ...ALL_DRIVER_PORTS]));

  // 1) mDNS hints (best-effort, instant for AxeOS).
  const mdnsHits = options.mdns === false ? [] : await discoverViaMdns(1800).catch(() => []);
  const mdnsIps = new Set(mdnsHits.map((h) => h.ip));

  // 2) Port-knock every subnet in parallel.
  const openMaps = await Promise.all(
    subnets.map((subnet) => findOpenHosts({ subnet, from, to, ports: knockPorts, timeoutMs: 400, concurrency })),
  );
  const liveHosts: OpenHostMap = new Map();
  for (const map of openMaps) {
    for (const [ip, ports] of map) liveHosts.set(ip, ports);
  }
  // mDNS hits that the sweep missed (e.g. different subnet) get probed on all ports.
  for (const ip of mdnsIps) {
    if (!liveHosts.has(ip)) liveHosts.set(ip, new Set(knockPorts));
  }

  // 3) Identify + poll each live host.
  const hosts = [...liveHosts.entries()];
  const discovered: DiscoveredMiner[] = [];
  let cursor = 0;
  const workers = new Array(Math.min(48, Math.max(1, hosts.length))).fill(null).map(async () => {
    while (cursor < hosts.length) {
      const [ip, ports] = hosts[cursor++];
      const miner = await probeHost(ip, ports, timeoutMs);
      if (miner) discovered.push(miner);
    }
  });
  await Promise.all(workers);

  return discovered
    .sort((a, b) => a.ip.localeCompare(b.ip, undefined, { numeric: true }))
    .map((miner, idx) => ({
      ...miner,
      id: `${miner.protocol || 'miner'}-${idx + 1}-${miner.ip.split('.').pop()}`,
    }));
}
