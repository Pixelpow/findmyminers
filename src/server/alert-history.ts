import { appendAlertEventRow, readAlertEventRows } from './app-store-db';

export type AlertEvent = {
  ts: number;
  type: 'thermal' | 'hashrate-drop' | 'pool-down' | 'anomaly' | 'daily-report' | 'maintenance';
  minerId: string;
  minerName: string;
  message: string;
  resolved?: boolean;
};

export async function readAlertHistory(orgId = 'public'): Promise<AlertEvent[]> {
  const effectiveOrgId = orgId || 'public';
  return readAlertEventRows(effectiveOrgId);
}

export async function appendAlertEvent(event: AlertEvent, orgId = 'public'): Promise<void> {
  const effectiveOrgId = orgId || 'public';
  appendAlertEventRow(effectiveOrgId, event);
}
