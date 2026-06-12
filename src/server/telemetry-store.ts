import { appendTelemetryPoint, readTelemetryPoints } from './app-store-db';

export type MinerSnapshot = {
  ts: number;
  hashrateTHs: number;
  tempAvg: number;
  tempMax: number;
  powerW: number;
  bestShare: number;
  lastDiff: number;
  diffAccepted: number;
  diffRejected: number;
  stale: number;
  rejected: number;
  accepted: number;
  hardwareErrors: number;
  poolAlive: boolean;
};

const lastPersistByMiner: Record<string, number> = {};

export async function readTelemetry(minerId = 'findmyminers-main', orgId = 'public'): Promise<MinerSnapshot[]> {
  const effectiveOrgId = orgId || 'public';
  return readTelemetryPoints(effectiveOrgId, minerId);
}

export async function appendTelemetry(minerId: string, snapshot: MinerSnapshot, orgId = 'public'): Promise<void> {
  const effectiveOrgId = orgId || 'public';
  const now = Date.now();
  const persistKey = `${effectiveOrgId}:${minerId}`;
  const lastPersist = lastPersistByMiner[persistKey] ?? 0;
  if (now - lastPersist < 20_000) return;
  lastPersistByMiner[persistKey] = now;

  appendTelemetryPoint(effectiveOrgId, minerId, snapshot);
}

export function rangeToMs(range: string): number {
  switch (range) {
    case '1h':
      return 60 * 60 * 1000;
    case '6h':
      return 6 * 60 * 60 * 1000;
    case '24h':
      return 24 * 60 * 60 * 1000;
    case '7d':
      return 7 * 24 * 60 * 60 * 1000;
    case '30d':
      return 30 * 24 * 60 * 60 * 1000;
    default:
      return 24 * 60 * 60 * 1000;
  }
}

export function getPointsForRange(points: MinerSnapshot[], range: string): MinerSnapshot[] {
  const windowMs = rangeToMs(range);
  const minTs = Date.now() - windowMs;
  return points.filter((point) => point.ts >= minTs);
}

export function average(values: number[]): number {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}
