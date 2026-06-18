const fs = require('fs');
const path = require('path');
const net = require('net');
const os = require('os');

const DEFAULT_CONFIG = {
  serverUrl: 'http://localhost:3000',
  agentKey: '',
  agentId: '',
  orgId: 'public',
  subnetPrefix: '192.168.1',
  subnetPrefixes: [],
  startHost: 1,
  endHost: 254,
  cgminerPort: 4028,
  intervalMs: 20000,
  versionCheckIntervalMs: 1800000,
  requestTimeoutMs: 2500,
  httpTimeoutMs: 2500,
  maxConcurrentHosts: 30,
  minerIdPrefix: 'miner',
  minerNamePrefix: 'Miner',
  axeOsPorts: [80],
};

const APP_STARTED_AT = Date.now();
const AGENT_VERSION = resolveAgentVersion();
const AGENT_PLATFORM = resolvePlatform();
let cachedUpdateState = { latestVersion: AGENT_VERSION, updateAvailable: false, checkedAt: 0 };

function appBaseDir() {
  if (process.pkg) return path.dirname(process.execPath);
  return process.cwd();
}

function resolveAgentVersion() {
  try {
    const pkgPath = path.join(process.cwd(), 'package.json');
    if (fs.existsSync(pkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      if (typeof pkg.version === 'string' && pkg.version.trim()) return pkg.version.trim();
    }
  } catch {
    // Fall through to default.
  }

  return process.env.AGENT_VERSION || '0.1.0';
}

function resolvePlatform() {
  if (process.platform === 'win32' && process.arch === 'x64') return 'win-x64';
  if (process.platform === 'linux' && process.arch === 'x64') return 'linux-x64';
  if (process.platform === 'linux' && process.arch === 'arm64') return 'linux-arm64';
  return `${process.platform}-${process.arch}`;
}

function compareVersions(left, right) {
  const leftParts = String(left || '0.0.0').split('.').map((part) => parseInt(part, 10) || 0);
  const rightParts = String(right || '0.0.0').split('.').map((part) => parseInt(part, 10) || 0);
  const length = Math.max(leftParts.length, rightParts.length);

  for (let index = 0; index < length; index += 1) {
    const l = leftParts[index] || 0;
    const r = rightParts[index] || 0;
    if (l < r) return -1;
    if (l > r) return 1;
  }

  return 0;
}

function loadConfig() {
  const configPath = path.join(appBaseDir(), 'agent-config.json');
  let fileConfig = {};

  if (fs.existsSync(configPath)) {
    try {
      fileConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    } catch (error) {
      console.error(`[ERROR] Invalid config JSON: ${error.message}`);
    }
  }

  const config = {
    ...DEFAULT_CONFIG,
    ...fileConfig,
  };

  if (!config.agentKey || typeof config.agentKey !== 'string') {
    throw new Error('Missing agentKey in agent-config.json');
  }

  if (!Array.isArray(config.subnetPrefixes)) {
    config.subnetPrefixes = [];
  }

  return config;
}

function normalizeSubnetPrefixes(config) {
  const normalized = [];

  if (Array.isArray(config.subnetPrefixes)) {
    for (const prefix of config.subnetPrefixes) {
      if (typeof prefix !== 'string') continue;
      const trimmed = prefix.trim();
      if (!trimmed) continue;
      if (!normalized.includes(trimmed)) normalized.push(trimmed);
    }
  }

  if (typeof config.subnetPrefix === 'string' && config.subnetPrefix.trim()) {
    const fallback = config.subnetPrefix.trim();
    if (!normalized.includes(fallback)) normalized.push(fallback);
  }

  if (normalized.length === 0) {
    normalized.push(DEFAULT_CONFIG.subnetPrefix);
  }

  return normalized;
}

function toNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function pickNumber(object, keys) {
  for (const key of keys) {
    if (!object || !(key in object)) continue;
    const value = toNumber(object[key]);
    if (value !== null) return value;
  }
  return null;
}

function toTHsFromValue(value, unitHint) {
  const numeric = toNumber(value);
  if (numeric === null) return 0;

  if (unitHint === 'TH') return numeric;
  if (unitHint === 'GH') return numeric / 1000;
  if (unitHint === 'MH') return numeric / 1_000_000;
  if (unitHint === 'KH') return numeric / 1_000_000_000;
  if (unitHint === 'H') return numeric / 1_000_000_000_000;

  if (numeric > 10_000) return numeric / 1_000_000;
  if (numeric > 100) return numeric / 1000;
  return numeric;
}

function extractHashrateTHsFromAxeOs(perf, info) {
  const candidates = [
    { obj: perf, key: 'hashRateTHs', unit: 'TH' },
    { obj: perf, key: 'hashRateTH', unit: 'TH' },
    { obj: perf, key: 'hashRateGHs', unit: 'GH' },
    { obj: perf, key: 'hashRateGH', unit: 'GH' },
    { obj: perf, key: 'hashrateGHs', unit: 'GH' },
    { obj: perf, key: 'hashrateGH', unit: 'GH' },
    { obj: perf, key: 'hashRate', unit: undefined },
    { obj: perf, key: 'hashrate', unit: undefined },
    { obj: info, key: 'hashRateTHs', unit: 'TH' },
    { obj: info, key: 'hashRateGHs', unit: 'GH' },
    { obj: info, key: 'hashRate', unit: undefined },
  ];

  for (const candidate of candidates) {
    if (!candidate.obj) continue;
    if (!(candidate.key in candidate.obj)) continue;
    const value = candidate.obj[candidate.key];
    const normalized = toTHsFromValue(value, candidate.unit);
    if (normalized > 0) return normalized;
  }

  return 0;
}

function parseMMID0(mmId0String) {
  if (!mmId0String || typeof mmId0String !== 'string') return {};
  const parsed = {};
  const matches = mmId0String.match(/([a-zA-Z0-9_]+)\[(.*?)\]/g);
  if (!matches) return parsed;

  for (const match of matches) {
    const kv = match.match(/([a-zA-Z0-9_]+)\[(.*?)\]/);
    if (kv) parsed[kv[1]] = kv[2];
  }
  return parsed;
}

function extractThermalFromDevs(devsData) {
  const temps = [];
  const fans = [];

  for (const dev of devsData || []) {
    const keys = Object.keys(dev || {});
    for (const key of keys) {
      if (/^Temperature|^Temp\d*|^Chip\s*Temp/i.test(key)) {
        const value = toNumber(dev[key]);
        if (value !== null && value > 0) temps.push(value);
      }
      if (/Fan|RPM/i.test(key)) {
        const value = toNumber(dev[key]);
        if (value !== null && value > 0) fans.push(value);
      }
    }
  }

  return {
    tempAvg: temps.length ? temps.reduce((sum, value) => sum + value, 0) / temps.length : 0,
    tempMax: temps.length ? Math.max(...temps) : 0,
    fanRpm: fans.length ? Math.max(...fans) : 0,
  };
}

function cgminerCommand(host, port, command, parameter, timeoutMs) {
  return new Promise((resolve, reject) => {
    const client = new net.Socket();
    let data = '';
    const payload = { command };
    if (parameter) payload.parameter = parameter;

    client.connect(port, host, () => {
      client.write(JSON.stringify(payload));
    });

    client.on('data', (chunk) => {
      data += chunk.toString('utf8');
    });

    client.on('close', () => {
      try {
        const cleanData = data.replace(/\0/g, '');
        resolve(JSON.parse(cleanData));
      } catch (error) {
        reject(error);
      }
    });

    client.on('error', reject);
    client.setTimeout(timeoutMs, () => {
      client.destroy();
      reject(new Error('cgminer timeout'));
    });
  });
}

async function fetchJsonWithTimeout(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, { method: 'GET', signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

function ipToMinerId(prefix, ip) {
  return `${prefix}-${ip.replace(/\./g, '-')}`;
}

async function fetchSnapshotForIp(ip, config) {
  const [summary, devs, stats, pools] = await Promise.all([
    cgminerCommand(ip, config.cgminerPort, 'summary', undefined, config.requestTimeoutMs),
    cgminerCommand(ip, config.cgminerPort, 'devs', undefined, config.requestTimeoutMs),
    cgminerCommand(ip, config.cgminerPort, 'stats', undefined, config.requestTimeoutMs),
    cgminerCommand(ip, config.cgminerPort, 'pools', undefined, config.requestTimeoutMs),
  ]);

  const minerStats = stats.STATS && stats.STATS.length > 0 ? stats.STATS[0] : {};
  const hardwareDetails = minerStats['MM ID0'] ? parseMMID0(minerStats['MM ID0']) : {};
  const devsData = devs.DEVS || [];
  const devThermal = extractThermalFromDevs(devsData);
  const summaryData = summary.SUMMARY ? summary.SUMMARY[0] : {};
  const poolsData = pools.POOLS || [];
  const activePool = poolsData.find((pool) => pool['Stratum Active']) || poolsData[0] || {};

  const hashrateTHs = summaryData?.['MHS 1m'] ? summaryData['MHS 1m'] / 1_000_000 : 0;
  const mmTempAvg = toNumber(hardwareDetails?.TAvg);
  const mmTempMax = toNumber(hardwareDetails?.TMax);
  const tempAvg = mmTempAvg ?? (devThermal.tempAvg || 0);
  const tempMax = mmTempMax ?? (devThermal.tempMax || tempAvg || 0);
  const powerW = hardwareDetails?.MPO
    ? parseFloat(hardwareDetails.MPO)
    : (hardwareDetails?.WORKMODE === '0' ? 65 : hardwareDetails?.WORKMODE === '2' ? 140 : 90);

  return {
    snapshot: {
      ts: Date.now(),
      hashrateTHs,
      tempAvg,
      tempMax,
      powerW,
      bestShare: Number(summaryData?.['Best Share'] || 0),
      lastDiff: Number(activePool?.['Last Share Difficulty'] || 0),
      diffAccepted: Number(summaryData?.['Difficulty Accepted'] || 0),
      diffRejected: Number(summaryData?.['Difficulty Rejected'] || 0),
      stale: Number(summaryData?.Stale || 0),
      rejected: Number(summaryData?.Rejected || 0),
      accepted: Number(summaryData?.Accepted || 0),
      hardwareErrors: Number(summaryData?.['Hardware Errors'] || 0),
      poolAlive: poolsData.some((pool) => pool.Status === 'Alive' && pool['Stratum Active'] === true),
    },
    summaryData,
    hardwareDetails,
    source: 'cgminer',
  };
}

async function fetchAxeOsSnapshotForIp(ip, config) {
  const ports = Array.isArray(config.axeOsPorts) && config.axeOsPorts.length > 0
    ? config.axeOsPorts
    : [80];

  let lastError = null;

  for (const port of ports) {
    const base = `http://${ip}:${port}`;

    try {
      const [info, perf, pools] = await Promise.all([
        fetchJsonWithTimeout(`${base}/api/system/info`, config.httpTimeoutMs),
        fetchJsonWithTimeout(`${base}/api/system/performance`, config.httpTimeoutMs),
        fetchJsonWithTimeout(`${base}/api/pools`, config.httpTimeoutMs).catch(() => []),
      ]);

      const hashrateTHs = extractHashrateTHsFromAxeOs(perf, info);
      if (hashrateTHs <= 0) {
        throw new Error('AxeOS detected but no hashrate found');
      }

      const tempAvg = pickNumber(perf, ['temp', 'temperature', 'tempC', 'boardTemp'])
        ?? pickNumber(info, ['temp', 'temperature', 'tempC', 'boardTemp'])
        ?? 0;
      const tempMax = pickNumber(perf, ['tempMax', 'maxTemp', 'hotspotTemp'])
        ?? pickNumber(info, ['tempMax', 'maxTemp', 'hotspotTemp'])
        ?? tempAvg;
      const powerW = pickNumber(perf, ['power', 'powerW', 'inputPower'])
        ?? pickNumber(info, ['power', 'powerW', 'inputPower'])
        ?? 0;

      const accepted = pickNumber(perf, ['accepted', 'sharesAccepted'])
        ?? pickNumber(info, ['accepted', 'sharesAccepted'])
        ?? 0;
      const rejected = pickNumber(perf, ['rejected', 'sharesRejected'])
        ?? pickNumber(info, ['rejected', 'sharesRejected'])
        ?? 0;
      const stale = pickNumber(perf, ['stale', 'sharesStale'])
        ?? pickNumber(info, ['stale', 'sharesStale'])
        ?? 0;
      const hardwareErrors = pickNumber(perf, ['hardwareErrors', 'hwErrors'])
        ?? pickNumber(info, ['hardwareErrors', 'hwErrors'])
        ?? 0;

      const poolEntries = Array.isArray(pools)
        ? pools
        : (Array.isArray(pools?.pools) ? pools.pools : []);

      const poolAlive = poolEntries.length > 0
        ? poolEntries.some((pool) => {
          const status = String(pool?.status || pool?.Status || '').toLowerCase();
          const active = pool?.active === true || pool?.enabled === true || pool?.['Stratum Active'] === true;
          return active || status.includes('alive') || status.includes('active') || status.includes('connected');
        })
        : true;

      const bestShare = pickNumber(perf, ['bestShare']) ?? pickNumber(info, ['bestShare']) ?? 0;
      const lastDiff = pickNumber(perf, ['lastDiff', 'lastShareDifficulty']) ?? 0;
      const diffAccepted = pickNumber(perf, ['diffAccepted', 'difficultyAccepted']) ?? accepted;
      const diffRejected = pickNumber(perf, ['diffRejected', 'difficultyRejected']) ?? rejected;

      return {
        snapshot: {
          ts: Date.now(),
          hashrateTHs,
          tempAvg,
          tempMax,
          powerW,
          bestShare,
          lastDiff,
          diffAccepted,
          diffRejected,
          stale,
          rejected,
          accepted,
          hardwareErrors,
          poolAlive,
        },
        summaryData: {
          model: info?.model || info?.board || info?.hardware,
          version: info?.version || info?.firmware,
        },
        hardwareDetails: info || {},
        source: 'axeos-http',
      };
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error('AxeOS detection failed');
}

async function postSnapshot(config, payload) {
  const res = await fetch(`${config.serverUrl.replace(/\/$/, '')}/api/agent/ingest`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-agent-key': config.agentKey,
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Ingest failed ${res.status}: ${text}`);
  }
}

async function postHeartbeat(config, payload) {
  const res = await fetch(`${config.serverUrl.replace(/\/$/, '')}/api/agent/heartbeat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-agent-key': config.agentKey,
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Heartbeat failed ${res.status}: ${text}`);
  }
}

/* ----------------------------------------------------------------------- *
 *  Command channel: receive control commands from the dashboard and run    *
 *  them locally against the miner on the LAN, then report the result.      *
 * ----------------------------------------------------------------------- */

async function httpJson(url, method, body, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method,
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res;
  } finally {
    clearTimeout(timer);
  }
}

async function executeCgminerControl(cmd, config) {
  const { minerIp, minerPort, action, value } = cmd;
  const port = minerPort || config.cgminerPort;
  switch (action) {
    case 'fan':
      return cgminerCommand(minerIp, port, 'ascset', `0,fan-spd,${value || ''}`, config.requestTimeoutMs);
    case 'mode':
      return cgminerCommand(minerIp, port, 'ascset', `0,workmode,${value || ''}`, config.requestTimeoutMs);
    case 'target-temp':
      return cgminerCommand(minerIp, port, 'ascset', `0,target-temp,${value || ''}`, config.requestTimeoutMs);
    case 'smart-speed':
      return cgminerCommand(minerIp, port, 'ascset', `0,smart-speed,${value || ''}`, config.requestTimeoutMs);
    case 'switchpool':
      return cgminerCommand(minerIp, port, 'switchpool', value || '0', config.requestTimeoutMs);
    case 'reboot':
      return cgminerCommand(minerIp, port, 'ascset', '0,reboot,1', config.requestTimeoutMs);
    default:
      throw new Error(`cgminer agent cannot perform "${action}"`);
  }
}

async function executeAxeOsControl(cmd, config) {
  const { minerIp, action, value } = cmd;
  const ports = Array.isArray(config.axeOsPorts) && config.axeOsPorts.length ? config.axeOsPorts : [80];
  const base = `http://${minerIp}:${ports[0]}`;
  switch (action) {
    case 'reboot':
      return httpJson(`${base}/api/system/restart`, 'POST', undefined, config.httpTimeoutMs);
    case 'fan':
      return httpJson(`${base}/api/system`, 'PATCH', { autofanspeed: 0, fanspeed: Number(value) }, config.httpTimeoutMs);
    case 'smart-speed':
      return httpJson(`${base}/api/system`, 'PATCH', { autofanspeed: value === '1' ? 1 : 0 }, config.httpTimeoutMs);
    case 'frequency':
      return httpJson(`${base}/api/system`, 'PATCH', { frequency: Number(value) }, config.httpTimeoutMs);
    case 'voltage':
      return httpJson(`${base}/api/system`, 'PATCH', { coreVoltage: Number(value) }, config.httpTimeoutMs);
    default:
      throw new Error(`AxeOS agent cannot perform "${action}"`);
  }
}

async function ackCommand(config, commandId, success, error) {
  try {
    await fetch(`${config.serverUrl.replace(/\/$/, '')}/api/agent/commands`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-agent-key': config.agentKey },
      body: JSON.stringify({ orgId: config.orgId, commandId, success, error: error || undefined }),
    });
  } catch (e) {
    console.error(`[CMD] ack failed for ${commandId}: ${e.message}`);
  }
}

async function pollAndRunCommands(config, agentId) {
  const url = `${config.serverUrl.replace(/\/$/, '')}/api/agent/commands?orgId=${encodeURIComponent(config.orgId)}&agentId=${encodeURIComponent(agentId)}&wait=1`;
  const res = await fetch(url, { method: 'GET', headers: { 'x-agent-key': config.agentKey } });
  if (!res.ok) throw new Error(`commands poll HTTP ${res.status}`);
  const payload = await res.json();
  const commands = Array.isArray(payload.commands) ? payload.commands : [];

  for (const cmd of commands) {
    try {
      if (cmd.protocol === 'axeos') {
        await executeAxeOsControl(cmd, config);
      } else {
        await executeCgminerControl(cmd, config);
      }
      console.log(`[CMD] ${cmd.action} -> ${cmd.minerIp} OK (${cmd.id})`);
      await ackCommand(config, cmd.id, true);
    } catch (error) {
      console.error(`[CMD] ${cmd.action} -> ${cmd.minerIp} FAILED: ${error.message}`);
      await ackCommand(config, cmd.id, false, error.message);
    }
  }
}

async function commandLoop(config, agentId) {
  // Long-polls the dashboard for control commands and executes them on the LAN.
  while (true) {
    try {
      await pollAndRunCommands(config, agentId);
    } catch (error) {
      console.error(`[CMD] ${error.message}`);
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
  }
}

async function checkForUpdates(config) {
  const now = Date.now();
  if (now - cachedUpdateState.checkedAt < config.versionCheckIntervalMs) {
    return cachedUpdateState;
  }

  try {
    const res = await fetch(`${config.serverUrl.replace(/\/$/, '')}/api/agent/version`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const payload = await res.json();
    const latestVersion = typeof payload.version === 'string' ? payload.version : AGENT_VERSION;
    cachedUpdateState = {
      latestVersion,
      updateAvailable: compareVersions(AGENT_VERSION, latestVersion) < 0,
      checkedAt: now,
    };
  } catch {
    cachedUpdateState = {
      ...cachedUpdateState,
      checkedAt: now,
    };
  }

  return cachedUpdateState;
}

function buildHostList(config) {
  const subnetPrefixes = normalizeSubnetPrefixes(config);
  const hosts = [];
  for (const subnetPrefix of subnetPrefixes) {
    for (let host = config.startHost; host <= config.endHost; host += 1) {
      hosts.push(`${subnetPrefix}.${host}`);
    }
  }
  return hosts;
}

async function runWithConcurrency(items, limit, worker) {
  const queue = [...items];
  const runners = Array.from({ length: Math.max(1, limit) }, async () => {
    while (queue.length > 0) {
      const item = queue.shift();
      if (!item) break;
      await worker(item);
    }
  });
  await Promise.all(runners);
}

async function scanAndPush(config) {
  const hosts = buildHostList(config);
  const startedAt = Date.now();
  let found = 0;

  await runWithConcurrency(hosts, config.maxConcurrentHosts, async (ip) => {
    try {
      let payload;
      try {
        payload = await fetchSnapshotForIp(ip, config);
      } catch {
        payload = await fetchAxeOsSnapshotForIp(ip, config);
      }

      const { snapshot, summaryData, source } = payload;
      const minerId = ipToMinerId(config.minerIdPrefix, ip);
      const modelSuffix = summaryData?.model ? ` (${summaryData.model})` : '';
      const minerName = `${config.minerNamePrefix} ${ip}${modelSuffix}`;

      await postSnapshot(config, {
        orgId: config.orgId,
        minerId,
        minerName,
        minerIp: ip,
        minerPort: config.cgminerPort,
        protocol: source === 'axeos-http' ? 'axeos' : 'cgminer',
        snapshot,
      });

      found += 1;
      console.log(`[OK] ${ip} -> ${minerId} (${snapshot.hashrateTHs.toFixed(2)} TH/s, ${source})`);
    } catch {
      // Silent for non-miner IPs.
    }
  });

  const elapsedMs = Date.now() - startedAt;
  console.log(`[SCAN] done in ${elapsedMs} ms, miners found: ${found}`);
  return { found, elapsedMs };
}

async function main() {
  const config = loadConfig();
  const subnetPrefixes = normalizeSubnetPrefixes(config);
  const agentId = config.agentId || `${os.hostname().toLowerCase()}-${AGENT_PLATFORM}`;
  console.log('[AGENT] FindMyMiners Windows Agent started');
  console.log(`[AGENT] server=${config.serverUrl} orgId=${config.orgId} subnets=${subnetPrefixes.join(',')} hosts=${config.startHost}-${config.endHost}`);
  console.log(`[AGENT] version=${AGENT_VERSION} platform=${AGENT_PLATFORM} agentId=${agentId}`);

  // Command channel runs independently so control actions stay responsive
  // regardless of the (slower) scan/telemetry interval.
  commandLoop(config, agentId).catch((error) => {
    console.error(`[CMD] command loop crashed: ${error.message}`);
  });

  while (true) {
    try {
      const scanResult = await scanAndPush(config);
      const updateState = await checkForUpdates(config);

      if (updateState.updateAvailable) {
        console.log(`[UPDATE] New agent version available: ${updateState.latestVersion} (current ${AGENT_VERSION})`);
      }

      await postHeartbeat(config, {
        orgId: config.orgId,
        agentId,
        version: AGENT_VERSION,
        hostname: os.hostname(),
        platform: AGENT_PLATFORM,
        latestVersion: updateState.latestVersion,
        updateAvailable: updateState.updateAvailable,
        lastScanAt: Date.now(),
        minersDetected: scanResult.found,
        uptimeSeconds: Math.floor((Date.now() - APP_STARTED_AT) / 1000),
      });
    } catch (error) {
      console.error(`[ERROR] ${error.message}`);
    }
    await new Promise((resolve) => setTimeout(resolve, config.intervalMs));
  }
}

main().catch((error) => {
  console.error(`[FATAL] ${error.message}`);
  process.exit(1);
});
