/**
 * AxeOS HTTP API client.
 * Used for Bitaxe, NerdAxe, NerdOctaxe, NerdQAxe++, and other AxeOS-based miners
 * that expose a REST API on port 80.
 *
 * All data comes from GET /api/system/info — there are NO separate
 * /api/system/performance or /api/pools endpoints.
 *
 * Hashrate is reported in GH/s by AxeOS.
 */
import http from 'http';
import { normaliseName } from './discover-miners';
import type { MinerSnapshot } from './telemetry-store';

/* ---------- low-level HTTP helper ---------- */

function httpGetJson(url: string, timeoutMs = 5000): Promise<any> {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { timeout: timeoutMs }, (res) => {
      let data = '';
      res.on('data', (chunk: Buffer | string) => { data += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch { reject(new Error('Invalid JSON')); }
      });
    });
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.on('error', reject);
  });
}

/* ---------- types ---------- */

export type AxeOsResult = {
  snapshot: MinerSnapshot;
  poolUrl: string;
  accountKey: string;
  model: string;
  firmware: string;
  chipType: string;
  fanRpm: number;
  uptime: number;
  frequencyMHz: number;
  coreVoltageMV: number;
  /** raw /api/system/info response */
  raw: { info: any };
};

/* ---------- main poller ---------- */

/**
 * Poll an AxeOS device via GET /api/system/info.
 * Returns null if the device doesn't respond or returns unexpected data.
 */
export async function pollAxeOs(ip: string, httpPort = 80, timeoutMs = 5000): Promise<AxeOsResult | null> {
  try {
    const base = `http://${ip}:${httpPort}`;
    const info = await httpGetJson(`${base}/api/system/info`, timeoutMs);

    if (!info || typeof info !== 'object') return null;
    // Must have at least one AxeOS indicator
    if (info.hashRate === undefined && info.hashRate_1m === undefined && info.sharesAccepted === undefined) return null;

    /* --- model / firmware --- */
    const rawModel = String(info.deviceModel || '').trim();
    const hostname = String(info.hostname || '').trim();
    const boardVersion = String(info.boardVersion || '').trim();
    const firmware = String(info.axeOSVersion || info.version || '').trim();
    const chipType = String(info.ASICModel || '').trim();
    const model = normaliseName(rawModel, hostname, boardVersion, firmware)
      || rawModel || hostname || 'AxeOS';

    /* --- hashrate (AxeOS reports in GH/s → divide by 1000 for TH/s) --- */
    const hashGHs = Number(info.hashRate || info.hashRate_1m || 0) || 0;
    const hashrateTHs = hashGHs / 1000;

    /* --- temperature --- */
    const temp1 = Number(info.temp) || 0;
    const temp2 = Number(info.temp2) || 0;
    const vrTemp = Number(info.vrTemp) || 0;
    const temps = [temp1, temp2, vrTemp].filter(t => t > 0);
    const tempAvg = temps.length ? temps.reduce((a, b) => a + b, 0) / temps.length : 0;
    const tempMax = temps.length ? Math.max(...temps) : 0;

    /* --- power (watts) --- */
    const powerW = Number(info.power) || 0;

    /* --- fan RPM --- */
    const fanRpm = Number(info.fanrpm) || 0;

    /* --- OC settings --- */
    const frequencyMHz = Number(info.frequency) || 0;
    const coreVoltageMV = Number(info.coreVoltage) || 0;

    /* --- uptime --- */
    const uptime = Number(info.uptimeSeconds) || 0;

    /* --- shares --- */
    const accepted = Number(info.sharesAccepted) || 0;
    const rejected = Number(info.sharesRejected) || 0;

    /* --- best difficulty --- */
    const bestDiff = Number(info.bestDiff || info.stratum?.totalBestDiff) || 0;
    const bestSessionDiff = Number(info.bestSessionDiff || info.stratum?.pools?.[0]?.bestDiff) || 0;

    /* --- pool URL --- */
    const stratumURL = String(info.stratumURL || '').trim();
    const stratumPort = Number(info.stratumPort) || 0;
    const poolUrl = stratumURL
      ? `stratum+tcp://${stratumURL}:${stratumPort}`
      : '';
    const accountKey = String(info.stratumUser || info.user || info.wallet || info.stratum?.user || info.stratum?.pools?.[0]?.user || '').trim() || poolUrl || 'unknown';
    const poolDifficulty = Number(info.poolDifficulty || info.stratum?.pools?.[0]?.poolDifficulty) || 0;
    const poolAlive = accepted > 0 && stratumURL.length > 0;

    /* --- build telemetry snapshot --- */
    const snapshot: MinerSnapshot = {
      ts: Date.now(),
      hashrateTHs,
      tempAvg: temp1 > 0 ? temp1 : tempAvg,  // primary temp sensor
      tempMax,
      powerW,
      bestShare: bestDiff,
      lastDiff: poolDifficulty,
      diffAccepted: accepted,
      diffRejected: rejected,
      stale: 0,
      rejected,
      accepted,
      hardwareErrors: 0,
      poolAlive,
    };

    return {
      snapshot,
      poolUrl,
      accountKey,
      model,
      firmware,
      chipType,
      fanRpm,
      uptime,
      frequencyMHz,
      coreVoltageMV,
      raw: { info },
    };
  } catch {
    return null;
  }
}
