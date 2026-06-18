import fs from 'fs';
import path from 'path';
import { DatabaseSync } from 'node:sqlite';

export type DiffSampleInput = {
  orgId: string;
  minerId: string;
  minerName: string;
  accountKey: string;
  poolUrl?: string;
  source?: string;
  bestDiff: number;
  lastDiff: number;
  diffAccepted: number;
  diffRejected: number;
  ts?: number;
};

export type MinerDiffAccountRecord = {
  accountKey: string;
  poolUrl: string | null;
  source: string | null;
  bestDiff: number;
  bestDiffAt: number | null;
  lastDiff: number;
  lastDiffAt: number | null;
  diffAccepted: number;
  diffRejected: number;
  updatedAt: number;
};

export type MinerDiffRecord = {
  minerId: string;
  minerName: string;
  bestDiff: number;
  bestDiffAt: number | null;
  bestDiffAccountKey: string | null;
  bestDiffPoolUrl: string | null;
  lastDiff: number;
  lastDiffAt: number | null;
  lastDiffAccountKey: string | null;
  lastDiffPoolUrl: string | null;
  updatedAt: number;
};

export type GlobalDiffRecord = {
  bestDiff: number;
  bestDiffAt: number | null;
  bestDiffMinerId: string | null;
  bestDiffMinerName: string | null;
  bestDiffAccountKey: string | null;
  bestDiffPoolUrl: string | null;
  lastDiff: number;
  lastDiffAt: number | null;
  lastDiffMinerId: string | null;
  lastDiffMinerName: string | null;
  lastDiffAccountKey: string | null;
  lastDiffPoolUrl: string | null;
  updatedAt: number;
};

export type MinerDiffSummary = {
  minerRecord: MinerDiffRecord | null;
  accountRecords: MinerDiffAccountRecord[];
  globalRecord: GlobalDiffRecord | null;
};

export type RecordDiffChanges = {
  newAccountBest: boolean;
  newMinerBest: boolean;
  newGlobalBest: boolean;
  bestDiff: number;
  minerId: string;
  minerName: string;
  accountKey: string;
  poolUrl: string | null;
  ts: number;
};

export type HallOfFameMinerRecord = {
  minerId: string;
  minerName: string;
  bestDiff: number;
  bestDiffAt: number | null;
  bestDiffAccountKey: string | null;
  bestDiffPoolUrl: string | null;
  lastDiff: number;
  updatedAt: number;
};

export type HallOfFameAccountRecord = {
  accountKey: string;
  bestDiff: number;
  bestDiffAt: number | null;
  lastDiff: number;
  updatedAt: number;
  minerCount: number;
  minerName: string | null;
  minerId: string | null;
  poolUrl: string | null;
};

export type HallOfFameSummary = {
  globalRecord: GlobalDiffRecord | null;
  topMiners: HallOfFameMinerRecord[];
  topAccounts: HallOfFameAccountRecord[];
  recentAccountRecords: MinerDiffAccountRecord[];
};

const DATA_DIR = path.join(process.cwd(), 'data');
const DB_PATH = path.join(DATA_DIR, 'miner-diff-records.sqlite');

let db: DatabaseSync | null = null;

function getDb() {
  if (db) return db;

  fs.mkdirSync(DATA_DIR, { recursive: true });
  db = new DatabaseSync(DB_PATH);
  db.exec(`
    CREATE TABLE IF NOT EXISTS miner_diff_account_records (
      org_id TEXT NOT NULL,
      miner_id TEXT NOT NULL,
      miner_name TEXT NOT NULL,
      account_key TEXT NOT NULL,
      pool_url TEXT,
      source TEXT,
      best_diff REAL NOT NULL DEFAULT 0,
      best_diff_at INTEGER,
      last_diff REAL NOT NULL DEFAULT 0,
      last_diff_at INTEGER,
      diff_accepted REAL NOT NULL DEFAULT 0,
      diff_rejected REAL NOT NULL DEFAULT 0,
      sample_count INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (org_id, miner_id, account_key)
    );

    CREATE TABLE IF NOT EXISTS miner_diff_records (
      org_id TEXT NOT NULL,
      miner_id TEXT NOT NULL,
      miner_name TEXT NOT NULL,
      best_diff REAL NOT NULL DEFAULT 0,
      best_diff_at INTEGER,
      best_diff_account_key TEXT,
      best_diff_pool_url TEXT,
      last_diff REAL NOT NULL DEFAULT 0,
      last_diff_at INTEGER,
      last_diff_account_key TEXT,
      last_diff_pool_url TEXT,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (org_id, miner_id)
    );

    CREATE TABLE IF NOT EXISTS global_diff_records (
      org_id TEXT PRIMARY KEY,
      best_diff REAL NOT NULL DEFAULT 0,
      best_diff_at INTEGER,
      best_diff_miner_id TEXT,
      best_diff_miner_name TEXT,
      best_diff_account_key TEXT,
      best_diff_pool_url TEXT,
      last_diff REAL NOT NULL DEFAULT 0,
      last_diff_at INTEGER,
      last_diff_miner_id TEXT,
      last_diff_miner_name TEXT,
      last_diff_account_key TEXT,
      last_diff_pool_url TEXT,
      updated_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_diff_account_org_miner ON miner_diff_account_records (org_id, miner_id);
  `);

  return db;
}

function stringOrNull(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function numberOrZero(value: unknown) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function normaliseAccountKey(accountKey: string, poolUrl?: string) {
  const trimmed = accountKey.trim();
  if (trimmed) return trimmed;
  return stringOrNull(poolUrl) || 'unknown';
}

export function extractAccountKeyFromMiningData(args: {
  activePool?: Record<string, unknown> | null;
  fallbackPoolUrl?: string;
  rawInfo?: Record<string, unknown> | null;
}) {
  const pool = args.activePool || {};
  const rawInfo = args.rawInfo || {};

  const directCandidates = [
    pool.User,
    pool.USER,
    pool.user,
    pool['User0'],
    pool['Stratum User'],
    rawInfo.stratumUser,
    rawInfo.user,
    rawInfo.wallet,
  ];

  for (const candidate of directCandidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim();
    }
  }

  const stratum = rawInfo.stratum;
  if (stratum && typeof stratum === 'object') {
    const nestedUser = (stratum as Record<string, unknown>).user;
    if (typeof nestedUser === 'string' && nestedUser.trim()) {
      return nestedUser.trim();
    }

    const pools = (stratum as Record<string, unknown>).pools;
    if (Array.isArray(pools) && pools[0] && typeof pools[0] === 'object') {
      const firstPoolUser = (pools[0] as Record<string, unknown>).user;
      if (typeof firstPoolUser === 'string' && firstPoolUser.trim()) {
        return firstPoolUser.trim();
      }
    }
  }

  return normaliseAccountKey('', args.fallbackPoolUrl);
}

type AccountRow = {
  best_diff: number;
  best_diff_at: number | null;
};

type MinerRow = {
  best_diff: number;
  best_diff_at: number | null;
};

type GlobalRow = {
  best_diff: number;
  best_diff_at: number | null;
};

export function recordDiffSample(input: DiffSampleInput) {
  const database = getDb();
  const ts = input.ts ?? Date.now();
  const accountKey = normaliseAccountKey(input.accountKey, input.poolUrl);
  const bestDiff = Math.max(0, numberOrZero(input.bestDiff));
  const lastDiff = Math.max(0, numberOrZero(input.lastDiff));
  const diffAccepted = Math.max(0, numberOrZero(input.diffAccepted));
  const diffRejected = Math.max(0, numberOrZero(input.diffRejected));
  const poolUrl = stringOrNull(input.poolUrl);
  const source = stringOrNull(input.source);
  let newAccountBest = false;
  let newMinerBest = false;
  let newGlobalBest = false;

  database.exec('BEGIN');

  try {
    const existingAccount = database.prepare(
      'SELECT best_diff, best_diff_at FROM miner_diff_account_records WHERE org_id = ? AND miner_id = ? AND account_key = ?'
    ).get<AccountRow>(input.orgId, input.minerId, accountKey);

    const nextAccountBestDiff = Math.max(existingAccount?.best_diff || 0, bestDiff);
    const nextAccountBestDiffAt = nextAccountBestDiff > (existingAccount?.best_diff || 0)
      ? ts
      : (existingAccount?.best_diff_at ?? null);
    newAccountBest = nextAccountBestDiff > (existingAccount?.best_diff || 0);

    database.prepare(`
      INSERT INTO miner_diff_account_records (
        org_id, miner_id, miner_name, account_key, pool_url, source,
        best_diff, best_diff_at, last_diff, last_diff_at,
        diff_accepted, diff_rejected, sample_count, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
      ON CONFLICT(org_id, miner_id, account_key) DO UPDATE SET
        miner_name = excluded.miner_name,
        pool_url = COALESCE(excluded.pool_url, miner_diff_account_records.pool_url),
        source = COALESCE(excluded.source, miner_diff_account_records.source),
        best_diff = excluded.best_diff,
        best_diff_at = excluded.best_diff_at,
        last_diff = excluded.last_diff,
        last_diff_at = excluded.last_diff_at,
        diff_accepted = excluded.diff_accepted,
        diff_rejected = excluded.diff_rejected,
        sample_count = miner_diff_account_records.sample_count + 1,
        updated_at = excluded.updated_at
    `).run(
      input.orgId,
      input.minerId,
      input.minerName,
      accountKey,
      poolUrl,
      source,
      nextAccountBestDiff,
      nextAccountBestDiffAt,
      lastDiff,
      lastDiff > 0 ? ts : null,
      diffAccepted,
      diffRejected,
      ts,
    );

    const existingMiner = database.prepare(
      'SELECT best_diff, best_diff_at FROM miner_diff_records WHERE org_id = ? AND miner_id = ?'
    ).get<MinerRow>(input.orgId, input.minerId);

    const nextMinerBestDiff = Math.max(existingMiner?.best_diff || 0, bestDiff);
    const nextMinerBestDiffAt = nextMinerBestDiff > (existingMiner?.best_diff || 0)
      ? ts
      : (existingMiner?.best_diff_at ?? null);
    newMinerBest = nextMinerBestDiff > (existingMiner?.best_diff || 0);

    database.prepare(`
      INSERT INTO miner_diff_records (
        org_id, miner_id, miner_name,
        best_diff, best_diff_at, best_diff_account_key, best_diff_pool_url,
        last_diff, last_diff_at, last_diff_account_key, last_diff_pool_url,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(org_id, miner_id) DO UPDATE SET
        miner_name = excluded.miner_name,
        best_diff = excluded.best_diff,
        best_diff_at = excluded.best_diff_at,
        best_diff_account_key = excluded.best_diff_account_key,
        best_diff_pool_url = excluded.best_diff_pool_url,
        last_diff = excluded.last_diff,
        last_diff_at = excluded.last_diff_at,
        last_diff_account_key = excluded.last_diff_account_key,
        last_diff_pool_url = excluded.last_diff_pool_url,
        updated_at = excluded.updated_at
    `).run(
      input.orgId,
      input.minerId,
      input.minerName,
      nextMinerBestDiff,
      nextMinerBestDiffAt,
      nextMinerBestDiff > (existingMiner?.best_diff || 0) ? accountKey : null,
      nextMinerBestDiff > (existingMiner?.best_diff || 0) ? poolUrl : null,
      lastDiff,
      lastDiff > 0 ? ts : null,
      accountKey,
      poolUrl,
      ts,
    );

    const existingGlobal = database.prepare(
      'SELECT best_diff, best_diff_at FROM global_diff_records WHERE org_id = ?'
    ).get<GlobalRow>(input.orgId);

    const nextGlobalBestDiff = Math.max(existingGlobal?.best_diff || 0, bestDiff);
    const nextGlobalBestDiffAt = nextGlobalBestDiff > (existingGlobal?.best_diff || 0)
      ? ts
      : (existingGlobal?.best_diff_at ?? null);
    newGlobalBest = nextGlobalBestDiff > (existingGlobal?.best_diff || 0);

    database.prepare(`
      INSERT INTO global_diff_records (
        org_id,
        best_diff, best_diff_at, best_diff_miner_id, best_diff_miner_name, best_diff_account_key, best_diff_pool_url,
        last_diff, last_diff_at, last_diff_miner_id, last_diff_miner_name, last_diff_account_key, last_diff_pool_url,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(org_id) DO UPDATE SET
        best_diff = excluded.best_diff,
        best_diff_at = excluded.best_diff_at,
        best_diff_miner_id = excluded.best_diff_miner_id,
        best_diff_miner_name = excluded.best_diff_miner_name,
        best_diff_account_key = excluded.best_diff_account_key,
        best_diff_pool_url = excluded.best_diff_pool_url,
        last_diff = excluded.last_diff,
        last_diff_at = excluded.last_diff_at,
        last_diff_miner_id = excluded.last_diff_miner_id,
        last_diff_miner_name = excluded.last_diff_miner_name,
        last_diff_account_key = excluded.last_diff_account_key,
        last_diff_pool_url = excluded.last_diff_pool_url,
        updated_at = excluded.updated_at
    `).run(
      input.orgId,
      nextGlobalBestDiff,
      nextGlobalBestDiffAt,
      nextGlobalBestDiff > (existingGlobal?.best_diff || 0) ? input.minerId : null,
      nextGlobalBestDiff > (existingGlobal?.best_diff || 0) ? input.minerName : null,
      nextGlobalBestDiff > (existingGlobal?.best_diff || 0) ? accountKey : null,
      nextGlobalBestDiff > (existingGlobal?.best_diff || 0) ? poolUrl : null,
      lastDiff,
      lastDiff > 0 ? ts : null,
      input.minerId,
      input.minerName,
      accountKey,
      poolUrl,
      ts,
    );

    database.exec('COMMIT');

    return {
      newAccountBest,
      newMinerBest,
      newGlobalBest,
      bestDiff,
      minerId: input.minerId,
      minerName: input.minerName,
      accountKey,
      poolUrl,
      ts,
    } satisfies RecordDiffChanges;
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
}

function readGlobalDiffRecord(orgId: string): GlobalDiffRecord | null {
  const database = getDb();
  const globalRow = database.prepare(`
    SELECT best_diff, best_diff_at, best_diff_miner_id, best_diff_miner_name, best_diff_account_key, best_diff_pool_url,
           last_diff, last_diff_at, last_diff_miner_id, last_diff_miner_name, last_diff_account_key, last_diff_pool_url, updated_at
    FROM global_diff_records
    WHERE org_id = ?
  `).get<{
    best_diff: number;
    best_diff_at: number | null;
    best_diff_miner_id: string | null;
    best_diff_miner_name: string | null;
    best_diff_account_key: string | null;
    best_diff_pool_url: string | null;
    last_diff: number;
    last_diff_at: number | null;
    last_diff_miner_id: string | null;
    last_diff_miner_name: string | null;
    last_diff_account_key: string | null;
    last_diff_pool_url: string | null;
    updated_at: number;
  }>(orgId);

  return globalRow ? {
    bestDiff: globalRow.best_diff,
    bestDiffAt: globalRow.best_diff_at,
    bestDiffMinerId: globalRow.best_diff_miner_id,
    bestDiffMinerName: globalRow.best_diff_miner_name,
    bestDiffAccountKey: globalRow.best_diff_account_key,
    bestDiffPoolUrl: globalRow.best_diff_pool_url,
    lastDiff: globalRow.last_diff,
    lastDiffAt: globalRow.last_diff_at,
    lastDiffMinerId: globalRow.last_diff_miner_id,
    lastDiffMinerName: globalRow.last_diff_miner_name,
    lastDiffAccountKey: globalRow.last_diff_account_key,
    lastDiffPoolUrl: globalRow.last_diff_pool_url,
    updatedAt: globalRow.updated_at,
  } : null;
}

export function readMinerDiffSummary(orgId: string, minerId: string): MinerDiffSummary {
  const database = getDb();

  const minerRow = database.prepare(`
    SELECT miner_id, miner_name, best_diff, best_diff_at, best_diff_account_key, best_diff_pool_url,
           last_diff, last_diff_at, last_diff_account_key, last_diff_pool_url, updated_at
    FROM miner_diff_records
    WHERE org_id = ? AND miner_id = ?
  `).get<{
    miner_id: string;
    miner_name: string;
    best_diff: number;
    best_diff_at: number | null;
    best_diff_account_key: string | null;
    best_diff_pool_url: string | null;
    last_diff: number;
    last_diff_at: number | null;
    last_diff_account_key: string | null;
    last_diff_pool_url: string | null;
    updated_at: number;
  }>(orgId, minerId);

  const accountRows = database.prepare(`
    SELECT account_key, pool_url, source, best_diff, best_diff_at, last_diff, last_diff_at,
           diff_accepted, diff_rejected, updated_at
    FROM miner_diff_account_records
    WHERE org_id = ? AND miner_id = ?
    ORDER BY best_diff DESC, updated_at DESC
  `).all<{
    account_key: string;
    pool_url: string | null;
    source: string | null;
    best_diff: number;
    best_diff_at: number | null;
    last_diff: number;
    last_diff_at: number | null;
    diff_accepted: number;
    diff_rejected: number;
    updated_at: number;
  }>(orgId, minerId);

  return {
    minerRecord: minerRow ? {
      minerId: minerRow.miner_id,
      minerName: minerRow.miner_name,
      bestDiff: minerRow.best_diff,
      bestDiffAt: minerRow.best_diff_at,
      bestDiffAccountKey: minerRow.best_diff_account_key,
      bestDiffPoolUrl: minerRow.best_diff_pool_url,
      lastDiff: minerRow.last_diff,
      lastDiffAt: minerRow.last_diff_at,
      lastDiffAccountKey: minerRow.last_diff_account_key,
      lastDiffPoolUrl: minerRow.last_diff_pool_url,
      updatedAt: minerRow.updated_at,
    } : null,
    accountRecords: accountRows.map((row) => ({
      accountKey: row.account_key,
      poolUrl: row.pool_url,
      source: row.source,
      bestDiff: row.best_diff,
      bestDiffAt: row.best_diff_at,
      lastDiff: row.last_diff,
      lastDiffAt: row.last_diff_at,
      diffAccepted: row.diff_accepted,
      diffRejected: row.diff_rejected,
      updatedAt: row.updated_at,
    })),
    globalRecord: readGlobalDiffRecord(orgId),
  };
}

export function readHallOfFame(orgId: string, limit = 10): HallOfFameSummary {
  const database = getDb();
  const safeLimit = Math.min(50, Math.max(3, limit));

  const topMiners = database.prepare(`
    SELECT miner_id, miner_name, best_diff, best_diff_at, best_diff_account_key, best_diff_pool_url,
           last_diff, updated_at
    FROM miner_diff_records
    WHERE org_id = ?
    ORDER BY best_diff DESC, updated_at ASC
    LIMIT ?
  `).all<{
    miner_id: string;
    miner_name: string;
    best_diff: number;
    best_diff_at: number | null;
    best_diff_account_key: string | null;
    best_diff_pool_url: string | null;
    last_diff: number;
    updated_at: number;
  }>(orgId, safeLimit).map((row) => ({
    minerId: row.miner_id,
    minerName: row.miner_name,
    bestDiff: row.best_diff,
    bestDiffAt: row.best_diff_at,
    bestDiffAccountKey: row.best_diff_account_key,
    bestDiffPoolUrl: row.best_diff_pool_url,
    lastDiff: row.last_diff,
    updatedAt: row.updated_at,
  }));

  const topAccounts = database.prepare(`
    WITH ranked_accounts AS (
      SELECT
        account_key,
        best_diff,
        best_diff_at,
        last_diff,
        updated_at,
        miner_name,
        miner_id,
        pool_url,
        ROW_NUMBER() OVER (PARTITION BY account_key ORDER BY best_diff DESC, updated_at ASC) AS row_num,
        COUNT(*) OVER (PARTITION BY account_key) AS miner_count
      FROM miner_diff_account_records
      WHERE org_id = ?
    )
    SELECT account_key, best_diff, best_diff_at, last_diff, updated_at, miner_count, miner_name, miner_id, pool_url
    FROM ranked_accounts
    WHERE row_num = 1
    ORDER BY best_diff DESC, updated_at ASC
    LIMIT ?
  `).all<{
    account_key: string;
    best_diff: number;
    best_diff_at: number | null;
    last_diff: number;
    updated_at: number;
    miner_count: number;
    miner_name: string | null;
    miner_id: string | null;
    pool_url: string | null;
  }>(orgId, safeLimit).map((row) => ({
    accountKey: row.account_key,
    bestDiff: row.best_diff,
    bestDiffAt: row.best_diff_at,
    lastDiff: row.last_diff,
    updatedAt: row.updated_at,
    minerCount: row.miner_count,
    minerName: row.miner_name,
    minerId: row.miner_id,
    poolUrl: row.pool_url,
  }));

  const recentAccountRecords = database.prepare(`
    SELECT account_key, pool_url, source, best_diff, best_diff_at, last_diff, last_diff_at,
           diff_accepted, diff_rejected, updated_at
    FROM miner_diff_account_records
    WHERE org_id = ?
    ORDER BY updated_at DESC
    LIMIT ?
  `).all<{
    account_key: string;
    pool_url: string | null;
    source: string | null;
    best_diff: number;
    best_diff_at: number | null;
    last_diff: number;
    last_diff_at: number | null;
    diff_accepted: number;
    diff_rejected: number;
    updated_at: number;
  }>(orgId, safeLimit).map((row) => ({
    accountKey: row.account_key,
    poolUrl: row.pool_url,
    source: row.source,
    bestDiff: row.best_diff,
    bestDiffAt: row.best_diff_at,
    lastDiff: row.last_diff,
    lastDiffAt: row.last_diff_at,
    diffAccepted: row.diff_accepted,
    diffRejected: row.diff_rejected,
    updatedAt: row.updated_at,
  }));

  return {
    globalRecord: readGlobalDiffRecord(orgId),
    topMiners,
    topAccounts,
    recentAccountRecords,
  };
}