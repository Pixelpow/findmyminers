/**
 * CGMiner / Avalon driver.
 *
 * Talks to any miner exposing the classic cgminer JSON-over-TCP API on
 * port 4028 (Avalon Nano/Mini, and generic cgminer-API devices). Control is
 * done with Avalon-style `ascset` commands.
 */
import type { MinerSnapshot } from '@/server/telemetry-store';
import { normaliseName } from './device-names';
import { cgminerQuery, cgminerCommandStrict, DEFAULT_TCP_TIMEOUT_MS } from './transport';
import { parseSetPoolValue, type DriverActionName, type MinerDriver, type MinerIdentity, type PollResult } from './types';

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

export function parseMMID0(mmId0String: string): Record<string, string> {
  const parsed: Record<string, string> = {};
  const matches = String(mmId0String || '').match(/([a-zA-Z0-9_]+)\[(.*?)\]/g);
  if (matches) {
    for (const m of matches) {
      const kv = m.match(/([a-zA-Z0-9_]+)\[(.*?)\]/);
      if (kv) parsed[kv[1]] = kv[2];
    }
  }
  return parsed;
}

function extractThermalFromDevs(devsData: Array<Record<string, unknown>>): { tempAvg: number; tempMax: number; fanRpm: number } {
  const temps: number[] = [];
  const fans: number[] = [];
  for (const dev of devsData || []) {
    for (const key of Object.keys(dev || {})) {
      if (/^Temperature|^Temp\d*|^Chip\s*Temp/i.test(key)) {
        const v = toNumber(dev[key]);
        if (v !== null && v > 0) temps.push(v);
      }
      if (/Fan|RPM/i.test(key)) {
        const v = toNumber(dev[key]);
        if (v !== null && v > 0) fans.push(v);
      }
    }
  }
  return {
    tempAvg: temps.length ? temps.reduce((a, b) => a + b, 0) / temps.length : 0,
    tempMax: temps.length ? Math.max(...temps) : 0,
    fanRpm: fans.length ? Math.max(...fans) : 0,
  };
}

type CgminerPoolEntry = {
  POOL?: number;
  URL?: string;
  User?: string;
  Status?: string;
  'Stratum Active'?: boolean;
  'Last Share Difficulty'?: number;
};

/** Read the `version` reply and infer model / firmware / device family. */
function readIdentity(versionResp: { VERSION?: Array<Record<string, unknown>> } | null, ip: string, port: number): MinerIdentity | null {
  const version = Array.isArray(versionResp?.VERSION) ? versionResp.VERSION[0] : null;
  if (!version) return null;

  const descRaw = String(version.Description || version.DESC || version.CGMiner || '').trim();
  const modelRaw = String(version.Model || version.MODEL || '').trim();
  const fwRaw = String(version.FW || version.Firmware || '').trim();
  const allText = `${descRaw} ${modelRaw} ${fwRaw}`;

  const isBitaxe = /bitaxe|nerdaxe|nerdqaxe|nerdoctaxe|piaxe|qaxe|lucky.?miner/i.test(allText);
  const isAvalon = /avalon/i.test(allText);
  const model = normaliseName(modelRaw, descRaw, fwRaw)
    || modelRaw
    || (isBitaxe ? 'Bitaxe' : isAvalon ? 'Avalon' : 'CGMiner');

  return {
    protocol: 'cgminer',
    port,
    model,
    firmware: fwRaw || undefined,
    deviceType: isBitaxe ? 'bitaxe' : 'asic',
  };
}

export const cgminerDriver: MinerDriver = {
  protocol: 'cgminer',
  label: 'CGMiner TCP',
  ports: [4028],
  capabilities: ['reboot', 'fan', 'mode', 'target-temp', 'smart-speed', 'switchpool', 'setpool'],

  async detect(ip, port, timeoutMs = DEFAULT_TCP_TIMEOUT_MS) {
    const versionResp = await cgminerQuery(ip, port, 'version', undefined, timeoutMs);
    if (!versionResp?.VERSION) return null;
    return readIdentity(versionResp, ip, port);
  },

  async poll(ip, port, timeoutMs = 5000): Promise<PollResult | null> {
    const [summary, devs, stats, pools, version] = await Promise.all([
      cgminerQuery(ip, port, 'summary', undefined, timeoutMs),
      cgminerQuery(ip, port, 'devs', undefined, timeoutMs),
      cgminerQuery(ip, port, 'stats', undefined, timeoutMs),
      cgminerQuery(ip, port, 'pools', undefined, timeoutMs),
      cgminerQuery(ip, port, 'version', undefined, timeoutMs),
    ]);

    const summaryData = summary?.SUMMARY?.[0];
    if (!summaryData) return null;

    const devsData = devs?.DEVS || [];
    const devThermal = extractThermalFromDevs(devsData);

    const minerStats = stats?.STATS?.[0] || {};
    const hardwareDetails = minerStats['MM ID0'] ? parseMMID0(minerStats['MM ID0']) : {};

    const poolsData: CgminerPoolEntry[] = pools?.POOLS || [];
    const activePool = poolsData.find((p) => p['Stratum Active']) || poolsData[0];

    const hashrateTHs = summaryData['MHS 1m'] ? summaryData['MHS 1m'] / 1_000_000 : 0;
    const mmTempAvg = toNumber(hardwareDetails.TAvg);
    const mmTempMax = toNumber(hardwareDetails.TMax);
    const tempAvg = mmTempAvg ?? (devThermal.tempAvg || 0);
    const tempMax = mmTempMax ?? (devThermal.tempMax || tempAvg || 0);
    const fanRpm = toNumber(hardwareDetails.FanR) ?? devThermal.fanRpm;
    const powerW = hardwareDetails.MPO
      ? parseFloat(hardwareDetails.MPO)
      : (hardwareDetails.WORKMODE === '0' ? 65 : hardwareDetails.WORKMODE === '2' ? 140 : 90);

    const identity = readIdentity(version, ip, port);

    const snapshot: MinerSnapshot = {
      ts: Date.now(),
      hashrateTHs,
      tempAvg,
      tempMax,
      powerW,
      bestShare: summaryData['Best Share'] || 0,
      lastDiff: activePool?.['Last Share Difficulty'] || 0,
      diffAccepted: summaryData['Difficulty Accepted'] || 0,
      diffRejected: summaryData['Difficulty Rejected'] || 0,
      stale: summaryData.Stale || 0,
      rejected: summaryData.Rejected || 0,
      accepted: summaryData.Accepted || 0,
      hardwareErrors: summaryData['Hardware Errors'] || 0,
      poolAlive: poolsData.some((p) => p.Status === 'Alive' && p['Stratum Active'] === true),
    };

    return {
      snapshot,
      source: 'cgminer',
      model: identity?.model,
      firmware: identity?.firmware,
      poolUrl: activePool?.URL || '',
      accountKey: activePool?.User || activePool?.URL || '',
      fanRpm: fanRpm || undefined,
      uptime: summaryData.Elapsed || undefined,
    };
  },

  async control(ip, port, action: DriverActionName, value?: string) {
    switch (action) {
      case 'fan':
        await cgminerCommandStrict(ip, port, 'ascset', `0,fan-spd,${value ?? ''}`);
        return;
      case 'mode':
        try {
          await cgminerCommandStrict(ip, port, 'ascset', `0,workmode,${value ?? ''}`);
        } catch (e) {
          const m = e instanceof Error ? e.message : '';
          // Certains firmwares Avalon (ex. Nano 3S / MM319) n'acceptent que workmode 0
          // et rejettent tout changement via l'API — message clair plutôt que le brut.
          if (/parameter error|unknown argument|missing|invalid modular/i.test(m)) {
            throw new Error('Ce mineur n’accepte pas le changement de mode via l’API (firmware Avalon). Règle le mode depuis l’app ou l’écran du mineur.');
          }
          throw e;
        }
        return;
      case 'target-temp':
        await cgminerCommandStrict(ip, port, 'ascset', `0,target-temp,${value ?? ''}`);
        return;
      case 'smart-speed':
        await cgminerCommandStrict(ip, port, 'ascset', `0,smart-speed,${value ?? ''}`);
        return;
      case 'switchpool':
        await cgminerCommandStrict(ip, port, 'switchpool', value ?? '0');
        return;
      case 'setpool': {
        const pool = parseSetPoolValue(value);
        // Ajoute le pool puis bascule dessus (l'API cgminer n'a pas de "set" direct).
        await cgminerCommandStrict(ip, port, 'addpool', `${pool.url},${pool.user},${pool.pass || 'x'}`);
        const pools = await cgminerQuery(ip, port, 'pools');
        const list: CgminerPoolEntry[] = pools?.POOLS || [];
        const added = [...list].reverse().find((p) => (p.URL || '').trim() === pool.url);
        if (added === undefined || added.POOL === undefined) {
          throw new Error('Pool ajouté mais introuvable dans la liste — bascule manuelle nécessaire');
        }
        await cgminerCommandStrict(ip, port, 'switchpool', String(added.POOL));
        return;
      }
      case 'reboot':
        await cgminerCommandStrict(ip, port, 'ascset', '0,reboot,1');
        return;
      default:
        throw new Error(`CGMiner driver does not support action "${action}"`);
    }
  },
};
