/**
 * Miner driver abstraction.
 *
 * A "driver" knows how to talk to ONE family of miners over ONE protocol.
 * Every driver implements the same `MinerDriver` interface, so the rest of the
 * app (discovery, fleet polling, control, the agent) never has to know which
 * protocol a given miner speaks.
 *
 * To add support for a new miner: create `src/server/drivers/<name>-driver.ts`,
 * implement `MinerDriver`, and register it in `src/server/drivers/index.ts`.
 * See `docs/DRIVERS.md` for a step-by-step guide.
 */
import type { MinerSnapshot } from '@/server/telemetry-store';

/** Wire protocol used to reach a miner. */
export type MinerProtocol = 'cgminer' | 'axeos' | 'whatsminer' | 'antminer';

/**
 * A capability is an action a driver knows how to perform.
 * The single-page UI renders only the buttons matching a miner's capabilities.
 */
export type MinerCapability =
  | 'reboot'
  | 'fan'
  | 'mode'
  | 'target-temp'
  | 'smart-speed'
  | 'switchpool'
  | 'setpool'
  | 'led'
  | 'frequency'
  | 'voltage';

/**
 * Payload de l'action `setpool`, sérialisé en JSON dans `value`.
 * Le driver reconfigure le pool primaire du mineur puis applique
 * (restart AxeOS, addpool+switchpool CGMiner).
 */
export type SetPoolPayload = {
  url: string;
  user: string;
  pass?: string;
};

/** Parse host/port d'une URL stratum (ex: stratum+tcp://pool.example.com:3333). */
export function parseStratumUrl(url: string): { host: string; port: number } | null {
  const match = url.trim().match(/^(?:[a-z+]+:\/\/)?([^:/\s]+)(?::(\d+))?/i);
  if (!match || !match[1]) return null;
  const port = match[2] ? parseInt(match[2], 10) : 3333;
  if (!Number.isFinite(port) || port < 1 || port > 65535) return null;
  return { host: match[1], port };
}

/** Désérialise la value JSON d'une action setpool, avec validation. */
export function parseSetPoolValue(value?: string): SetPoolPayload {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value || '');
  } catch {
    throw new Error('setpool attend une value JSON { url, user, pass }');
  }
  const candidate = parsed as Partial<SetPoolPayload>;
  if (!candidate || typeof candidate.url !== 'string' || !candidate.url.trim()) {
    throw new Error('setpool : url du pool manquante');
  }
  if (typeof candidate.user !== 'string' || !candidate.user.trim()) {
    throw new Error('setpool : wallet/worker manquant');
  }
  return { url: candidate.url.trim(), user: candidate.user.trim(), pass: candidate.pass || 'x' };
}

/** Canonical action names. A superset of `MinerCapability`. */
export type DriverActionName = MinerCapability;

export type DeviceType = 'asic' | 'bitaxe' | 'unknown';

/** Lightweight identity returned by `detect()` during discovery. */
export type MinerIdentity = {
  protocol: MinerProtocol;
  port: number;
  model: string;
  firmware?: string;
  deviceType?: DeviceType;
  chipType?: string;
};

/** Normalised result of polling a miner once. */
export type PollResult = {
  snapshot: MinerSnapshot;
  source: MinerProtocol;
  model?: string;
  firmware?: string;
  chipType?: string;
  poolUrl?: string;
  accountKey?: string;
  fanRpm?: number;
  frequencyMHz?: number;
  coreVoltageMV?: number;
  uptime?: number;
};

export interface MinerDriver {
  /** Stable protocol id (also stored on the miner config). */
  protocol: MinerProtocol;
  /** Human label shown in the UI, e.g. "CGMiner TCP" or "AxeOS HTTP". */
  label: string;
  /** Default port(s) to probe for this driver during discovery. */
  ports: number[];
  /** Actions this driver can perform. Drives the UI's available controls. */
  capabilities: MinerCapability[];

  /**
   * Cheap probe: is there a miner of this kind at ip:port?
   * Must return quickly and never throw (return null on any failure).
   */
  detect(ip: string, port: number, timeoutMs: number): Promise<MinerIdentity | null>;

  /**
   * Full telemetry poll. Returns null if the miner does not answer.
   * Must never throw.
   */
  poll(ip: string, port: number, timeoutMs?: number): Promise<PollResult | null>;

  /**
   * Execute a control action. Throws with a human-readable message on failure.
   * Should reject early for actions not in `capabilities`.
   */
  control(ip: string, port: number, action: DriverActionName, value?: string): Promise<void>;
}

/** Map a control action to the capability it requires. */
export function actionCapability(action: DriverActionName): MinerCapability {
  return action;
}
