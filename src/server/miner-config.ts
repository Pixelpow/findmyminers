import fs from 'fs/promises';
import path from 'path';

/** Wire protocol used to reach a miner (matches a registered driver). */
export type MinerProtocol = 'cgminer' | 'axeos' | 'whatsminer' | 'antminer';

export type MinerNode = {
  id: string;
  name: string;
  ip: string;
  port: number;
  enabled: boolean;
  model?: string;
  lastMaintenanceTs?: number;
  /** Driver protocol; defaults to cgminer for legacy configs. */
  protocol?: MinerProtocol;
  /**
   * How the dashboard reaches this miner:
   *  - 'direct' (default): the server polls/controls it over the LAN.
   *  - 'agent':  an on-prem agent relays polling + control commands.
   */
  managedBy?: 'direct' | 'agent';
  /** Agent id that manages this miner when managedBy === 'agent'. */
  agentId?: string;
};

export type AlertSettings = {
  webhookUrl?: string;
  telegramBotToken?: string;
  telegramChatId?: string;
  thermalThresholdC: number;
  hashrateDropRatio: number;
  anomalyDropRatio: number;
  reportHourLocal: number;
  autoMaintenanceEnabled: boolean;
  maintenanceTempC: number;
};

export type NightSchedule = {
  enabled: boolean;
  startHour: number;
  endHour: number;
  fanPercent: number;
  workMode: string;
};

export type DashboardConfig = {
  selectedMinerId: string;
  miners: MinerNode[];
  alerts: AlertSettings;
  profitability: {
    elecCostEurKwh: number;
    poolFeePct: number;
  };
  ui: {
    alertProfile: 'custom' | 'silent' | 'standard' | 'aggressive';
    stabilityProfile: 'stabilite-auto' | 'anti-chaleur' | 'nettoyage-airflow' | 'silence-nuit';
  };
  nightSchedule?: NightSchedule;
  autoReboot?: { enabled: boolean };
  vacationMode?: { enabled: boolean };
  walletAddresses?: string[];
};

const DATA_DIR = path.join(process.cwd(), 'data');

function configFileForOrg(orgId: string) {
  return path.join(DATA_DIR, `dashboard-config-${orgId}.json`);
}

const defaultConfig: DashboardConfig = {
  selectedMinerId: '',
  miners: [],
  alerts: {
    webhookUrl: process.env.ALERT_WEBHOOK_URL,
    telegramBotToken: process.env.ALERT_TELEGRAM_BOT_TOKEN,
    telegramChatId: process.env.ALERT_TELEGRAM_CHAT_ID,
    thermalThresholdC: Number(process.env.ALERT_TEMP_THRESHOLD_C ?? 90),
    hashrateDropRatio: Number(process.env.ALERT_HASHRATE_DROP_RATIO ?? 0.7),
    anomalyDropRatio: 0.5,
    reportHourLocal: 9,
    autoMaintenanceEnabled: false,
    maintenanceTempC: 92,
  },
  profitability: {
    elecCostEurKwh: Number(process.env.ELEC_COST_EUR_KWH ?? 0.25),
    poolFeePct: Number(process.env.POOL_FEE_PCT ?? 2),
  },
  ui: {
    alertProfile: 'standard',
    stabilityProfile: 'stabilite-auto',
  },
};

async function ensureConfigFile(orgId: string) {
  const configFile = configFileForOrg(orgId);
  await fs.mkdir(DATA_DIR, { recursive: true });
  try {
    await fs.access(configFile);
  } catch {
    await fs.writeFile(configFile, JSON.stringify(defaultConfig, null, 2), 'utf-8');
  }
}

export async function readDashboardConfig(orgId = 'public'): Promise<DashboardConfig> {
  const effectiveOrgId = orgId || 'public';
  const configFile = configFileForOrg(effectiveOrgId);
  await ensureConfigFile(effectiveOrgId);
  const raw = await fs.readFile(configFile, 'utf-8');
  try {
    const parsed = JSON.parse(raw) as DashboardConfig;
    return {
      ...defaultConfig,
      ...parsed,
      alerts: {
        ...defaultConfig.alerts,
        ...(parsed.alerts || {}),
      },
      profitability: {
        ...defaultConfig.profitability,
        ...(parsed.profitability || {}),
      },
      ui: {
        ...defaultConfig.ui,
        ...(parsed.ui || {}),
      },
      miners: Array.isArray(parsed.miners) ? parsed.miners : defaultConfig.miners,
    };
  } catch {
    return defaultConfig;
  }
}

export async function writeDashboardConfig(config: DashboardConfig, orgId = 'public'): Promise<void> {
  const effectiveOrgId = orgId || 'public';
  const configFile = configFileForOrg(effectiveOrgId);
  await ensureConfigFile(effectiveOrgId);
  await fs.writeFile(configFile, JSON.stringify(config, null, 2), 'utf-8');
}

export async function updateDashboardConfig(partial: Partial<DashboardConfig>, orgId = 'public'): Promise<DashboardConfig> {
  const current = await readDashboardConfig(orgId);
  const nextMiners = partial.miners ?? current.miners;
  const requestedSelectedMinerId = typeof partial.selectedMinerId === 'string' ? partial.selectedMinerId : current.selectedMinerId;
  const selectedExists = nextMiners.some((miner) => miner.id === requestedSelectedMinerId && miner.enabled);
  const fallbackSelected = nextMiners.find((miner) => miner.enabled)?.id ?? '';
  const merged: DashboardConfig = {
    ...current,
    ...partial,
    selectedMinerId: selectedExists ? requestedSelectedMinerId : fallbackSelected,
    alerts: {
      ...current.alerts,
      ...(partial.alerts || {}),
    },
    profitability: {
      ...current.profitability,
      ...(partial.profitability || {}),
    },
    nightSchedule: partial.nightSchedule !== undefined
      ? { ...(current.nightSchedule || {}), ...partial.nightSchedule }
      : current.nightSchedule,
    autoReboot: partial.autoReboot !== undefined
      ? { ...(current.autoReboot || { enabled: false }), ...partial.autoReboot }
      : current.autoReboot,
    vacationMode: partial.vacationMode !== undefined
      ? { ...(current.vacationMode || { enabled: false }), ...partial.vacationMode }
      : current.vacationMode,
    walletAddresses: partial.walletAddresses !== undefined
      ? partial.walletAddresses
      : current.walletAddresses,
    miners: nextMiners,
  };
  await writeDashboardConfig(merged, orgId);
  return merged;
}

export async function getMinerById(minerId?: string, orgId = 'public'): Promise<MinerNode> {
  const config = await readDashboardConfig(orgId);
  const effectiveId = minerId || config.selectedMinerId;
  const found = config.miners.find((miner) => miner.id === effectiveId && miner.enabled);
  if (found) return found;

  const fallback = config.miners.find((miner) => miner.enabled);
  if (!fallback) throw new Error('No enabled miner configured');
  return fallback;
}

export async function resolveMinerId(minerId?: string, orgId = 'public'): Promise<string> {
  const miner = await getMinerById(minerId, orgId);
  return miner.id;
}
