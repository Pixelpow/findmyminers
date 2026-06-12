/**
 * AxeOS driver (Bitaxe, NerdAxe, NerdOctaxe, NerdQAxe, PiAxe, QAxe, Lucky Miner…).
 *
 * Reads via GET /api/system/info (delegated to the canonical poller in
 * `server/axeos.ts`) and — new — controls the device via the AxeOS REST API:
 *   - PATCH /api/system           (fan, autofan, frequency, core voltage)
 *   - POST  /api/system/restart   (reboot)
 */
import { pollAxeOs } from '@/server/axeos';
import { normaliseName } from './device-names';
import { httpGetJson, httpJsonRequest, DEFAULT_HTTP_TIMEOUT_MS } from './transport';
import type { DriverActionName, MinerDriver, MinerIdentity, PollResult } from './types';

const DEFAULT_AXEOS_PORT = 80;

export const axeosDriver: MinerDriver = {
  protocol: 'axeos',
  label: 'AxeOS HTTP',
  ports: [80],
  capabilities: ['reboot', 'fan', 'smart-speed', 'frequency', 'voltage'],

  async detect(ip, port = DEFAULT_AXEOS_PORT, timeoutMs = 700): Promise<MinerIdentity | null> {
    const info = await httpGetJson(`http://${ip}:${port}/api/system/info`, timeoutMs);
    if (!info || typeof info !== 'object') return null;
    // Require at least one AxeOS-specific field.
    if (info.hashRate === undefined && info.hashRate_1m === undefined && info.ASICModel === undefined && info.sharesAccepted === undefined) {
      return null;
    }

    const rawModel = String(info.deviceModel || '').trim();
    const hostname = String(info.hostname || '').trim();
    const boardVersion = String(info.boardVersion || '').trim();
    const firmware = String(info.axeOSVersion || info.version || '').trim();
    const chipType = String(info.ASICModel || '').trim();
    const model = normaliseName(rawModel, hostname, boardVersion, firmware) || rawModel || hostname || 'AxeOS';

    return {
      protocol: 'axeos',
      port,
      model,
      firmware: firmware || undefined,
      deviceType: 'bitaxe',
      chipType: chipType || undefined,
    };
  },

  async poll(ip, port = DEFAULT_AXEOS_PORT, timeoutMs = DEFAULT_HTTP_TIMEOUT_MS): Promise<PollResult | null> {
    // AxeOS serves HTTP on 80 — ignore a cgminer-style 4028 left over from a
    // legacy config and fall back to the HTTP port.
    const httpPort = port && port !== 4028 ? port : DEFAULT_AXEOS_PORT;
    const result = await pollAxeOs(ip, httpPort, timeoutMs);
    if (!result) return null;
    return {
      snapshot: result.snapshot,
      source: 'axeos',
      model: result.model,
      firmware: result.firmware,
      chipType: result.chipType || undefined,
      poolUrl: result.poolUrl,
      accountKey: result.accountKey,
      fanRpm: result.fanRpm || undefined,
      frequencyMHz: result.frequencyMHz || undefined,
      coreVoltageMV: result.coreVoltageMV || undefined,
      uptime: result.uptime || undefined,
    };
  },

  async control(ip, port = DEFAULT_AXEOS_PORT, action: DriverActionName, value?: string) {
    const effectivePort = port && port !== 4028 ? port : DEFAULT_AXEOS_PORT;
    const base = `http://${ip}:${effectivePort}`;

    switch (action) {
      case 'reboot':
        await httpJsonRequest(`${base}/api/system/restart`, 'POST');
        return;
      case 'fan': {
        const pct = Number(value);
        if (!Number.isFinite(pct)) throw new Error('Fan speed must be a number (0–100)');
        // Disable auto fan when a manual speed is requested.
        await httpJsonRequest(`${base}/api/system`, 'PATCH', { autofanspeed: 0, fanspeed: Math.max(0, Math.min(100, pct)) });
        return;
      }
      case 'smart-speed':
        await httpJsonRequest(`${base}/api/system`, 'PATCH', { autofanspeed: value === '1' ? 1 : 0 });
        return;
      case 'frequency': {
        const mhz = Number(value);
        if (!Number.isFinite(mhz)) throw new Error('Frequency must be a number (MHz)');
        await httpJsonRequest(`${base}/api/system`, 'PATCH', { frequency: mhz });
        return;
      }
      case 'voltage': {
        const mv = Number(value);
        if (!Number.isFinite(mv)) throw new Error('Core voltage must be a number (mV)');
        await httpJsonRequest(`${base}/api/system`, 'PATCH', { coreVoltage: mv });
        return;
      }
      default:
        throw new Error(`AxeOS driver does not support action "${action}"`);
    }
  },
};
