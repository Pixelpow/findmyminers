import fs from 'fs';
import path from 'path';
import { DatabaseSync } from 'node:sqlite';
import type { AlertEvent } from './alert-history';
import type { MinerEvent } from './event-history';
import type { MinerSnapshot } from './telemetry-store';

type PushSubscriptionRecord = {
  endpoint: string;
  keys?: {
    p256dh?: string;
    auth?: string;
  };
};

const DATA_DIR = path.join(process.cwd(), 'data');
const DB_PATH = path.join(DATA_DIR, 'app-store.sqlite');
const MAX_POINTS = 12_000;
const MAX_EVENTS = 5_000;

let db: DatabaseSync | null = null;
const importedTelemetryKeys = new Set<string>();
const importedMinerEventOrgs = new Set<string>();
const importedAlertOrgs = new Set<string>();

function getDb() {
  if (db) return db;

  fs.mkdirSync(DATA_DIR, { recursive: true });
  db = new DatabaseSync(DB_PATH);
  db.exec(`
    CREATE TABLE IF NOT EXISTS telemetry_points (
      org_id TEXT NOT NULL,
      miner_id TEXT NOT NULL,
      ts INTEGER NOT NULL,
      hashrate_ths REAL NOT NULL,
      temp_avg REAL NOT NULL,
      temp_max REAL NOT NULL,
      power_w REAL NOT NULL,
      best_share REAL NOT NULL,
      last_diff REAL NOT NULL,
      diff_accepted REAL NOT NULL,
      diff_rejected REAL NOT NULL,
      stale REAL NOT NULL,
      rejected REAL NOT NULL,
      accepted REAL NOT NULL,
      hardware_errors REAL NOT NULL,
      pool_alive INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_telemetry_org_miner_ts ON telemetry_points (org_id, miner_id, ts);

    CREATE TABLE IF NOT EXISTS miner_events (
      org_id TEXT NOT NULL,
      ts INTEGER NOT NULL,
      type TEXT NOT NULL,
      category TEXT NOT NULL,
      severity TEXT NOT NULL,
      miner_id TEXT NOT NULL,
      miner_name TEXT NOT NULL,
      message TEXT NOT NULL,
      metadata_json TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_miner_events_org_miner_ts ON miner_events (org_id, miner_id, ts);

    CREATE TABLE IF NOT EXISTS alert_events (
      org_id TEXT NOT NULL,
      ts INTEGER NOT NULL,
      type TEXT NOT NULL,
      miner_id TEXT NOT NULL,
      miner_name TEXT NOT NULL,
      message TEXT NOT NULL,
      resolved INTEGER NOT NULL DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_alert_events_org_ts ON alert_events (org_id, ts);

    CREATE TABLE IF NOT EXISTS push_subscriptions (
      org_id TEXT NOT NULL,
      endpoint TEXT NOT NULL,
      subscription_json TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (org_id, endpoint)
    );

    CREATE TABLE IF NOT EXISTS agent_commands (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      agent_id TEXT,
      miner_id TEXT NOT NULL,
      miner_ip TEXT NOT NULL,
      miner_port INTEGER NOT NULL,
      protocol TEXT NOT NULL,
      action TEXT NOT NULL,
      value TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      error TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_agent_commands_org_status ON agent_commands (org_id, status, created_at);
  `);

  return db;
}

export type AgentCommandRow = {
  id: string;
  org_id: string;
  agent_id: string | null;
  miner_id: string;
  miner_ip: string;
  miner_port: number;
  protocol: string;
  action: string;
  value: string | null;
  status: string;
  error: string | null;
  created_at: number;
  updated_at: number;
};

export function insertAgentCommand(row: Omit<AgentCommandRow, 'status' | 'error' | 'updated_at'> & { created_at: number }) {
  const database = getDb();
  database.prepare(`
    INSERT INTO agent_commands (id, org_id, agent_id, miner_id, miner_ip, miner_port, protocol, action, value, status, error, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', NULL, ?, ?)
  `).run(
    row.id, row.org_id, row.agent_id, row.miner_id, row.miner_ip, row.miner_port,
    row.protocol, row.action, row.value, row.created_at, row.created_at,
  );
}

/** Atomically claim up to `limit` pending commands for an org/agent. */
export function claimAgentCommands(orgId: string, agentId: string | null, limit = 20): AgentCommandRow[] {
  const database = getDb();
  const rows = database.prepare(`
    SELECT * FROM agent_commands
    WHERE org_id = ? AND status = 'pending' AND (agent_id IS NULL OR agent_id = ?)
    ORDER BY created_at ASC
    LIMIT ?
  `).all<AgentCommandRow>(orgId, agentId, limit);

  if (rows.length) {
    const now = Date.now();
    const mark = database.prepare(`UPDATE agent_commands SET status = 'claimed', updated_at = ? WHERE id = ?`);
    for (const row of rows) mark.run(now, row.id);
  }
  return rows;
}

export function ackAgentCommand(orgId: string, id: string, success: boolean, error?: string) {
  const database = getDb();
  database.prepare(`
    UPDATE agent_commands SET status = ?, error = ?, updated_at = ? WHERE org_id = ? AND id = ?
  `).run(success ? 'done' : 'error', error || null, Date.now(), orgId, id);
}

/** Housekeeping: drop commands older than `maxAgeMs` (default 1h). */
export function pruneAgentCommands(maxAgeMs = 60 * 60 * 1000) {
  const database = getDb();
  database.prepare(`DELETE FROM agent_commands WHERE created_at < ?`).run(Date.now() - maxAgeMs);
}

function historyFileFor(orgId: string, minerId: string) {
  return path.join(DATA_DIR, `telemetry-history-${orgId}-${minerId}.json`);
}

function minerEventsFileFor(orgId: string) {
  return path.join(DATA_DIR, `miner-events-${orgId}.json`);
}

function alertFileFor(orgId: string) {
  return path.join(DATA_DIR, `alert-history-${orgId}.json`);
}

function readJsonFile<T>(filePath: string): T | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T;
  } catch {
    return null;
  }
}

function importTelemetryIfNeeded(orgId: string, minerId: string) {
  const importKey = `${orgId}:${minerId}`;
  if (importedTelemetryKeys.has(importKey)) return;
  importedTelemetryKeys.add(importKey);

  const database = getDb();
  const existingCount = database.prepare('SELECT COUNT(1) AS count FROM telemetry_points WHERE org_id = ? AND miner_id = ?').get<{ count: number }>(orgId, minerId)?.count || 0;
  if (existingCount > 0) return;

  const rows = readJsonFile<MinerSnapshot[]>(historyFileFor(orgId, minerId));
  if (!Array.isArray(rows) || !rows.length) return;

  const insert = database.prepare(`
    INSERT INTO telemetry_points (
      org_id, miner_id, ts, hashrate_ths, temp_avg, temp_max, power_w,
      best_share, last_diff, diff_accepted, diff_rejected, stale, rejected,
      accepted, hardware_errors, pool_alive
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  database.exec('BEGIN');
  try {
    for (const row of rows) {
      insert.run(
        orgId,
        minerId,
        row.ts,
        row.hashrateTHs,
        row.tempAvg,
        row.tempMax,
        row.powerW,
        row.bestShare,
        row.lastDiff,
        row.diffAccepted,
        row.diffRejected,
        row.stale,
        row.rejected,
        row.accepted,
        row.hardwareErrors,
        row.poolAlive ? 1 : 0,
      );
    }
    database.exec('COMMIT');
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
}

function importMinerEventsIfNeeded(orgId: string) {
  if (importedMinerEventOrgs.has(orgId)) return;
  importedMinerEventOrgs.add(orgId);

  const database = getDb();
  const existingCount = database.prepare('SELECT COUNT(1) AS count FROM miner_events WHERE org_id = ?').get<{ count: number }>(orgId)?.count || 0;
  if (existingCount > 0) return;

  const events = readJsonFile<MinerEvent[]>(minerEventsFileFor(orgId));
  if (!Array.isArray(events) || !events.length) return;

  const insert = database.prepare(`
    INSERT INTO miner_events (org_id, ts, type, category, severity, miner_id, miner_name, message, metadata_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  database.exec('BEGIN');
  try {
    for (const event of events) {
      insert.run(
        orgId,
        event.ts,
        event.type,
        event.category,
        event.severity,
        event.minerId,
        event.minerName,
        event.message,
        event.metadata ? JSON.stringify(event.metadata) : null,
      );
    }
    database.exec('COMMIT');
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
}

function importAlertsIfNeeded(orgId: string) {
  if (importedAlertOrgs.has(orgId)) return;
  importedAlertOrgs.add(orgId);

  const database = getDb();
  const existingCount = database.prepare('SELECT COUNT(1) AS count FROM alert_events WHERE org_id = ?').get<{ count: number }>(orgId)?.count || 0;
  if (existingCount > 0) return;

  const events = readJsonFile<AlertEvent[]>(alertFileFor(orgId));
  if (!Array.isArray(events) || !events.length) return;

  const insert = database.prepare(`
    INSERT INTO alert_events (org_id, ts, type, miner_id, miner_name, message, resolved)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  database.exec('BEGIN');
  try {
    for (const event of events) {
      insert.run(orgId, event.ts, event.type, event.minerId, event.minerName, event.message, event.resolved ? 1 : 0);
    }
    database.exec('COMMIT');
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
}

export function readTelemetryPoints(orgId: string, minerId: string): MinerSnapshot[] {
  importTelemetryIfNeeded(orgId, minerId);
  const database = getDb();
  const rows = database.prepare(`
    SELECT ts, hashrate_ths, temp_avg, temp_max, power_w, best_share, last_diff,
           diff_accepted, diff_rejected, stale, rejected, accepted, hardware_errors, pool_alive
    FROM telemetry_points
    WHERE org_id = ? AND miner_id = ?
    ORDER BY ts ASC
  `).all<{
    ts: number;
    hashrate_ths: number;
    temp_avg: number;
    temp_max: number;
    power_w: number;
    best_share: number;
    last_diff: number;
    diff_accepted: number;
    diff_rejected: number;
    stale: number;
    rejected: number;
    accepted: number;
    hardware_errors: number;
    pool_alive: number;
  }>(orgId, minerId);

  return rows.map((row) => ({
    ts: row.ts,
    hashrateTHs: row.hashrate_ths,
    tempAvg: row.temp_avg,
    tempMax: row.temp_max,
    powerW: row.power_w,
    bestShare: row.best_share,
    lastDiff: row.last_diff,
    diffAccepted: row.diff_accepted,
    diffRejected: row.diff_rejected,
    stale: row.stale,
    rejected: row.rejected,
    accepted: row.accepted,
    hardwareErrors: row.hardware_errors,
    poolAlive: !!row.pool_alive,
  }));
}

export function appendTelemetryPoint(orgId: string, minerId: string, snapshot: MinerSnapshot) {
  importTelemetryIfNeeded(orgId, minerId);
  const database = getDb();

  database.prepare(`
    INSERT INTO telemetry_points (
      org_id, miner_id, ts, hashrate_ths, temp_avg, temp_max, power_w,
      best_share, last_diff, diff_accepted, diff_rejected, stale, rejected,
      accepted, hardware_errors, pool_alive
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    orgId,
    minerId,
    snapshot.ts,
    snapshot.hashrateTHs,
    snapshot.tempAvg,
    snapshot.tempMax,
    snapshot.powerW,
    snapshot.bestShare,
    snapshot.lastDiff,
    snapshot.diffAccepted,
    snapshot.diffRejected,
    snapshot.stale,
    snapshot.rejected,
    snapshot.accepted,
    snapshot.hardwareErrors,
    snapshot.poolAlive ? 1 : 0,
  );

  database.prepare(`
    DELETE FROM telemetry_points
    WHERE rowid IN (
      SELECT rowid FROM telemetry_points
      WHERE org_id = ? AND miner_id = ?
      ORDER BY ts DESC
      LIMIT -1 OFFSET ?
    )
  `).run(orgId, minerId, MAX_POINTS);
}

export function readMinerEventRows(orgId: string): MinerEvent[] {
  importMinerEventsIfNeeded(orgId);
  const database = getDb();
  const rows = database.prepare(`
    SELECT ts, type, category, severity, miner_id, miner_name, message, metadata_json
    FROM miner_events
    WHERE org_id = ?
    ORDER BY ts ASC
  `).all<{
    ts: number;
    type: string;
    category: MinerEvent['category'];
    severity: MinerEvent['severity'];
    miner_id: string;
    miner_name: string;
    message: string;
    metadata_json: string | null;
  }>(orgId);

  return rows.map((row) => ({
    ts: row.ts,
    type: row.type,
    category: row.category,
    severity: row.severity,
    minerId: row.miner_id,
    minerName: row.miner_name,
    message: row.message,
    metadata: row.metadata_json ? JSON.parse(row.metadata_json) as MinerEvent['metadata'] : undefined,
  }));
}

export function appendMinerEventRow(orgId: string, event: MinerEvent) {
  importMinerEventsIfNeeded(orgId);
  const database = getDb();
  database.prepare(`
    INSERT INTO miner_events (org_id, ts, type, category, severity, miner_id, miner_name, message, metadata_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(orgId, event.ts, event.type, event.category, event.severity, event.minerId, event.minerName, event.message, event.metadata ? JSON.stringify(event.metadata) : null);

  database.prepare(`
    DELETE FROM miner_events
    WHERE rowid IN (
      SELECT rowid FROM miner_events
      WHERE org_id = ?
      ORDER BY ts DESC
      LIMIT -1 OFFSET ?
    )
  `).run(orgId, MAX_EVENTS);
}

export function readAlertEventRows(orgId: string): AlertEvent[] {
  importAlertsIfNeeded(orgId);
  const database = getDb();
  const rows = database.prepare(`
    SELECT ts, type, miner_id, miner_name, message, resolved
    FROM alert_events
    WHERE org_id = ?
    ORDER BY ts ASC
  `).all<{
    ts: number;
    type: AlertEvent['type'];
    miner_id: string;
    miner_name: string;
    message: string;
    resolved: number;
  }>(orgId);

  return rows.map((row) => ({
    ts: row.ts,
    type: row.type,
    minerId: row.miner_id,
    minerName: row.miner_name,
    message: row.message,
    resolved: !!row.resolved,
  }));
}

export function appendAlertEventRow(orgId: string, event: AlertEvent) {
  importAlertsIfNeeded(orgId);
  const database = getDb();
  database.prepare(`
    INSERT INTO alert_events (org_id, ts, type, miner_id, miner_name, message, resolved)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(orgId, event.ts, event.type, event.minerId, event.minerName, event.message, event.resolved ? 1 : 0);

  database.prepare(`
    DELETE FROM alert_events
    WHERE rowid IN (
      SELECT rowid FROM alert_events
      WHERE org_id = ?
      ORDER BY ts DESC
      LIMIT -1 OFFSET ?
    )
  `).run(orgId, MAX_EVENTS);
}

export function savePushSubscription(orgId: string, subscription: PushSubscriptionRecord) {
  const database = getDb();
  const now = Date.now();
  database.prepare(`
    INSERT INTO push_subscriptions (org_id, endpoint, subscription_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(org_id, endpoint) DO UPDATE SET
      subscription_json = excluded.subscription_json,
      updated_at = excluded.updated_at
  `).run(orgId, subscription.endpoint, JSON.stringify(subscription), now, now);
}

export function deletePushSubscription(orgId: string, endpoint: string) {
  const database = getDb();
  database.prepare('DELETE FROM push_subscriptions WHERE org_id = ? AND endpoint = ?').run(orgId, endpoint);
}

export function listPushSubscriptions(orgId: string): PushSubscriptionRecord[] {
  const database = getDb();
  const rows = database.prepare('SELECT subscription_json FROM push_subscriptions WHERE org_id = ?').all<{ subscription_json: string }>(orgId);
  return rows.map((row) => JSON.parse(row.subscription_json) as PushSubscriptionRecord);
}