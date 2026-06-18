import { appendMinerEventRow, readMinerEventRows } from './app-store-db';

export type MinerEventCategory = 'system' | 'action' | 'alert' | 'maintenance';
export type MinerEventSeverity = 'info' | 'success' | 'warning' | 'critical';

export type MinerEvent = {
  ts: number;
  type: string;
  category: MinerEventCategory;
  severity: MinerEventSeverity;
  minerId: string;
  minerName: string;
  message: string;
  metadata?: Record<string, string | number | boolean | null>;
};

type AppendMinerEventOptions = {
  dedupeKey?: string;
  dedupeWindowMs?: number;
};

const lastEventByKey: Record<string, number> = {};

export async function readMinerEvents(orgId = 'public'): Promise<MinerEvent[]> {
  const effectiveOrgId = orgId || 'public';
  return readMinerEventRows(effectiveOrgId);
}

export async function appendMinerEvent(
  event: MinerEvent,
  orgId = 'public',
  options: AppendMinerEventOptions = {},
): Promise<void> {
  const effectiveOrgId = orgId || 'public';
  const dedupeKey = options.dedupeKey ? `${effectiveOrgId}:${options.dedupeKey}` : null;
  const dedupeWindowMs = options.dedupeWindowMs ?? 0;
  const now = Date.now();

  if (dedupeKey) {
    const lastTs = lastEventByKey[dedupeKey] ?? 0;
    if (now - lastTs < dedupeWindowMs) {
      return;
    }
    lastEventByKey[dedupeKey] = now;
  }

  appendMinerEventRow(effectiveOrgId, event);
}