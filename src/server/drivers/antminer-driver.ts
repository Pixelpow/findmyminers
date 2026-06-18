/**
 * Antminer (stock firmware / BMMiner) driver.
 *
 * Stock Antminers expose a READ-ONLY cgminer-style API on port 4028 where the
 * hashrate is reported in GH/s (not MH/s like Avalon). Detection runs before
 * the generic cgminer driver so the units are interpreted correctly.
 *
 * Write control (reboot, pool change, tuning) on stock firmware goes through
 * the authenticated web CGI (`/cgi-bin/*.cgi`, HTTP digest auth), which needs
 * per-miner credentials. That is intentionally left as a contribution point —
 * see docs/DRIVERS.md. BraiinsOS devices expose richer APIs and could get their
 * own driver.
 */
import type { MinerSnapshot } from '@/server/telemetry-store';
import { normaliseName } from './device-names';
import { cgminerQuery, DEFAULT_TCP_TIMEOUT_MS } from './transport';
import type { MinerDriver, MinerIdentity, PollResult } from './types';

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function isAntminer(versionResp: any): boolean {
  const v = versionResp?.VERSION?.[0];
  if (!v) return false;
  const text = `${v.Type || ''} ${v.BMMiner || ''} ${v.Miner || ''} ${v.Description || ''}`.toLowerCase();
  return /antminer|bmminer/.test(text);
}

/** Pull all temp* / fan* numeric fields out of an Antminer STATS object. */
function extractStatsThermal(stats: any): { tempMax: number; tempAvg: number; fanRpm: number } {
  const temps: number[] = [];
  const fans: number[] = [];
  for (const key of Object.keys(stats || {})) {
    if (/^temp(\d+|_\w+)?$/i.test(key) || /chip.?temp/i.test(key)) {
      const v = toNumber(stats[key]);
      if (v !== null && v > 0) temps.push(v);
    }
    if (/^fan\d*$/i.test(key)) {
      const v = toNumber(stats[key]);
      if (v !== null && v > 0) fans.push(v);
    }
  }
  return {
    tempMax: temps.length ? Math.max(...temps) : 0,
    tempAvg: temps.length ? temps.reduce((a, b) => a + b, 0) / temps.length : 0,
    fanRpm: fans.length ? Math.max(...fans) : 0,
  };
}

export const antminerDriver: MinerDriver = {
  protocol: 'antminer',
  label: 'Antminer (BMMiner)',
  ports: [4028],
  // Read-only over the TCP API. Write control requires the authenticated web CGI.
  capabilities: [],

  async detect(ip, port, timeoutMs = DEFAULT_TCP_TIMEOUT_MS): Promise<MinerIdentity | null> {
    const versionResp = await cgminerQuery(ip, port, 'version', undefined, timeoutMs);
    if (!isAntminer(versionResp)) return null;
    const v = versionResp.VERSION[0];
    const typeRaw = String(v.Type || '').trim();
    const fwRaw = String(v.BMMiner || v.CompileTime || '').trim();
    const model = normaliseName(typeRaw) || typeRaw || 'Antminer';
    return { protocol: 'antminer', port, model, firmware: fwRaw || undefined, deviceType: 'asic' };
  },

  async poll(ip, port, timeoutMs = 5000): Promise<PollResult | null> {
    const [summary, stats, pools, version] = await Promise.all([
      cgminerQuery(ip, port, 'summary', undefined, timeoutMs),
      cgminerQuery(ip, port, 'stats', undefined, timeoutMs),
      cgminerQuery(ip, port, 'pools', undefined, timeoutMs),
      cgminerQuery(ip, port, 'version', undefined, timeoutMs),
    ]);

    if (!isAntminer(version)) return null;
    const summaryData = summary?.SUMMARY?.[0];
    if (!summaryData) return null;

    // Antminer reports hashrate in GH/s.
    const ghs = Number(summaryData['GHS av'] ?? summaryData['GHS 5s'] ?? 0) || 0;
    const hashrateTHs = ghs > 0
      ? ghs / 1000
      : (summaryData['MHS av'] ? Number(summaryData['MHS av']) / 1_000_000 : 0);

    // Temps / fans live in the per-board STATS rows.
    const statRows: any[] = stats?.STATS || [];
    let tempMax = 0;
    let tempAvg = 0;
    let fanRpm = 0;
    for (const row of statRows) {
      const t = extractStatsThermal(row);
      if (t.tempMax > tempMax) tempMax = t.tempMax;
      if (t.tempAvg > tempAvg) tempAvg = t.tempAvg;
      if (t.fanRpm > fanRpm) fanRpm = t.fanRpm;
    }

    const poolsData = pools?.POOLS || [];
    const activePool = poolsData.find((p: any) => p['Stratum Active']) || poolsData[0];

    const v = version.VERSION[0];
    const model = normaliseName(String(v.Type || '')) || String(v.Type || '') || 'Antminer';

    const snapshot: MinerSnapshot = {
      ts: Date.now(),
      hashrateTHs,
      tempAvg: tempAvg || tempMax,
      tempMax: tempMax || tempAvg,
      powerW: Number(summaryData['Power'] || 0) || 0,
      bestShare: Number(summaryData['Best Share'] || 0) || 0,
      lastDiff: Number(activePool?.['Last Share Difficulty'] || 0) || 0,
      diffAccepted: Number(summaryData['Difficulty Accepted'] || 0) || 0,
      diffRejected: Number(summaryData['Difficulty Rejected'] || 0) || 0,
      stale: Number(summaryData['Stale'] || 0) || 0,
      rejected: Number(summaryData['Rejected'] || 0) || 0,
      accepted: Number(summaryData['Accepted'] || 0) || 0,
      hardwareErrors: Number(summaryData['Hardware Errors'] || 0) || 0,
      poolAlive: poolsData.some((p: any) => p.Status === 'Alive' && p['Stratum Active'] === true),
    };

    return {
      snapshot,
      source: 'antminer',
      model,
      firmware: String(v.BMMiner || '') || undefined,
      poolUrl: activePool?.URL || '',
      accountKey: activePool?.User || activePool?.URL || '',
      fanRpm: fanRpm || undefined,
      uptime: Number(summaryData['Elapsed'] || 0) || undefined,
    };
  },

  async control(_ip, _port, action) {
    throw new Error(
      `Antminer control ("${action}") is not yet implemented: stock firmware needs the authenticated web CGI. ` +
      'See docs/DRIVERS.md to contribute it.',
    );
  },
};
