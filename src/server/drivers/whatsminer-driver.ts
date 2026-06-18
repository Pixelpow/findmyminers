/**
 * Whatsminer (btminer) driver.
 *
 * Whatsminers expose a cgminer-style READ API on port 4028 (summary/devs/pools)
 * where hashrate is reported in MH/s. Detection runs before the generic cgminer
 * driver so model naming and units are correct.
 *
 * Write control uses MicroBT's token-based, AES-encrypted Write API (set_power,
 * reboot, update_pools…). Implementing that securely is a focused task left as a
 * contribution point — see docs/DRIVERS.md.
 */
import type { MinerSnapshot } from '@/server/telemetry-store';
import { normaliseName } from './device-names';
import { cgminerQuery, DEFAULT_TCP_TIMEOUT_MS } from './transport';
import type { MinerDriver, MinerIdentity, PollResult } from './types';

function num(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function isWhatsminer(...responses: any[]): boolean {
  const text = responses
    .map((r) => JSON.stringify(r?.VERSION?.[0] || r?.DEVDETAILS?.[0] || r?.STATS?.[0] || ''))
    .join(' ')
    .toLowerCase();
  return /whatsminer|btminer|microbt/.test(text);
}

export const whatsminerDriver: MinerDriver = {
  protocol: 'whatsminer',
  label: 'Whatsminer (btminer)',
  ports: [4028],
  // Read-only over the public API. Write control needs the token/AES Write API.
  capabilities: [],

  async detect(ip, port, timeoutMs = DEFAULT_TCP_TIMEOUT_MS): Promise<MinerIdentity | null> {
    const [version, devdetails] = await Promise.all([
      cgminerQuery(ip, port, 'version', undefined, timeoutMs),
      cgminerQuery(ip, port, 'devdetails', undefined, timeoutMs),
    ]);
    if (!isWhatsminer(version, devdetails)) return null;
    const dd = devdetails?.DEVDETAILS?.[0] || {};
    const v = version?.VERSION?.[0] || {};
    const modelRaw = String(dd.Model || dd.Name || v.Type || '').trim();
    const model = normaliseName(modelRaw, JSON.stringify(v)) || modelRaw || 'Whatsminer';
    return {
      protocol: 'whatsminer',
      port,
      model,
      firmware: String(v.MMVersion || v.btminer || v.Version || '').trim() || undefined,
      deviceType: 'asic',
    };
  },

  async poll(ip, port, timeoutMs = 5000): Promise<PollResult | null> {
    const [summary, pools, devdetails, version] = await Promise.all([
      cgminerQuery(ip, port, 'summary', undefined, timeoutMs),
      cgminerQuery(ip, port, 'pools', undefined, timeoutMs),
      cgminerQuery(ip, port, 'devdetails', undefined, timeoutMs),
      cgminerQuery(ip, port, 'version', undefined, timeoutMs),
    ]);

    if (!isWhatsminer(version, devdetails)) return null;
    const summaryData = summary?.SUMMARY?.[0];
    if (!summaryData) return null;

    // Whatsminer reports MH/s in the summary.
    const mhs = num(summaryData['MHS av'] || summaryData['MHS 5s'] || summaryData['MHS 1m']);
    const hashrateTHs = mhs / 1_000_000;

    const poolsData = pools?.POOLS || [];
    const activePool = poolsData.find((p: any) => p['Stratum Active']) || poolsData[0];

    const dd = devdetails?.DEVDETAILS?.[0] || {};
    const modelRaw = String(dd.Model || dd.Name || '').trim();
    const model = normaliseName(modelRaw) || modelRaw || 'Whatsminer';

    const snapshot: MinerSnapshot = {
      ts: Date.now(),
      hashrateTHs,
      // Whatsminer exposes Temperature on summary; env temp differs by model.
      tempAvg: num(summaryData['Temperature']),
      tempMax: num(summaryData['Temperature']),
      powerW: num(summaryData['Power']),
      bestShare: num(summaryData['Best Share']),
      lastDiff: num(activePool?.['Last Share Difficulty']),
      diffAccepted: num(summaryData['Difficulty Accepted']),
      diffRejected: num(summaryData['Difficulty Rejected']),
      stale: num(summaryData['Stale']),
      rejected: num(summaryData['Rejected']),
      accepted: num(summaryData['Accepted']),
      hardwareErrors: num(summaryData['Hardware Errors']),
      poolAlive: poolsData.some((p: any) => p.Status === 'Alive' && p['Stratum Active'] === true),
    };

    return {
      snapshot,
      source: 'whatsminer',
      model,
      poolUrl: activePool?.URL || '',
      accountKey: activePool?.User || activePool?.URL || '',
      uptime: num(summaryData['Elapsed']) || undefined,
    };
  },

  async control(_ip, _port, action) {
    throw new Error(
      `Whatsminer control ("${action}") is not yet implemented: it requires MicroBT's token/AES Write API. ` +
      'See docs/DRIVERS.md to contribute it.',
    );
  },
};
