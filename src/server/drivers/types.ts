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
  | 'led'
  | 'frequency'
  | 'voltage';

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
