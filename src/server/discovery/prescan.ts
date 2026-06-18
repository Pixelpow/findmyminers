/**
 * Network pre-scan helpers.
 *
 * Instead of running every driver's full probe against all 254 hosts of a /24,
 * we first do a cheap TCP "port-knock" to find which hosts are actually
 * listening on a miner port. The (much smaller) list of live hosts is then
 * handed to the driver registry for real identification. This is typically
 * 5-10× faster than the naive sweep.
 */
import os from 'os';
import { tcpPortOpen } from '@/server/drivers/transport';

/** All IPv4 /24 subnet prefixes for non-internal interfaces (e.g. "192.168.1"). */
export function getLocalSubnets(): string[] {
  const prefixes: string[] = [];
  const interfaces = os.networkInterfaces();
  for (const values of Object.values(interfaces)) {
    for (const info of values || []) {
      if (info.family === 'IPv4' && !info.internal) {
        const parts = info.address.split('.');
        if (parts.length === 4) {
          const prefix = `${parts[0]}.${parts[1]}.${parts[2]}`;
          if (!prefixes.includes(prefix)) prefixes.push(prefix);
        }
      }
    }
  }
  return prefixes;
}

/** First local subnet, or a sensible default. */
export function getDefaultSubnet(): string {
  return getLocalSubnets()[0] || '192.168.1';
}

async function runWithConcurrency<T>(items: T[], limit: number, worker: (item: T) => Promise<void>): Promise<void> {
  let cursor = 0;
  const runners = new Array(Math.max(1, limit)).fill(null).map(async () => {
    while (cursor < items.length) {
      const item = items[cursor++];
      await worker(item);
    }
  });
  await Promise.all(runners);
}

export type OpenHostMap = Map<string, Set<number>>;

/**
 * Port-knock a host range. Returns only hosts with at least one open port,
 * mapped to the set of ports found open.
 */
export async function findOpenHosts(options: {
  subnet: string;
  from: number;
  to: number;
  ports: number[];
  timeoutMs?: number;
  concurrency?: number;
}): Promise<OpenHostMap> {
  const { subnet, from, to, ports } = options;
  const timeoutMs = options.timeoutMs ?? 400;
  const concurrency = Math.max(1, Math.min(256, options.concurrency ?? 128));

  const targets: { ip: string; port: number }[] = [];
  for (let host = from; host <= to; host++) {
    const ip = `${subnet}.${host}`;
    for (const port of ports) targets.push({ ip, port });
  }

  const open: OpenHostMap = new Map();
  await runWithConcurrency(targets, concurrency, async ({ ip, port }) => {
    if (await tcpPortOpen(ip, port, timeoutMs)) {
      const set = open.get(ip) ?? new Set<number>();
      set.add(port);
      open.set(ip, set);
    }
  });

  return open;
}
