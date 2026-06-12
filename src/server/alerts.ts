import { AlertSettings, MinerNode } from '@/server/miner-config';
import { MinerSnapshot } from '@/server/telemetry-store';
import { appendAlertEvent } from '@/server/alert-history';
import { appendMinerEvent } from '@/server/event-history';
import { sendCgminerCommand } from '@/server/cgminer';

type AlertType = 'thermal' | 'hashrate-drop' | 'pool-down' | 'anomaly' | 'daily-report';

const cooldownMsByType: Record<AlertType, number> = {
  thermal: 10 * 60 * 1000,
  'hashrate-drop': 15 * 60 * 1000,
  'pool-down': 5 * 60 * 1000,
  anomaly: 20 * 60 * 1000,
  'daily-report': 60 * 60 * 1000,
};

const lastAlertAt: Record<string, number> = {};

function inferHashrateCause(snapshot: MinerSnapshot, avgHashrateTHs: number, longAvgHashrateTHs: number) {
  if (!snapshot.poolAlive) {
    return 'Likely cause: pool connectivity or share submission issue.';
  }

  if (snapshot.tempAvg >= 88 || snapshot.tempMax >= 94) {
    return 'Likely cause: thermal throttling or airflow degradation.';
  }

  if (avgHashrateTHs > 0 && snapshot.hashrateTHs < avgHashrateTHs * 0.5) {
    return 'Likely cause: unstable tuning, board issue, or fan profile mismatch.';
  }

  if (longAvgHashrateTHs > 0 && snapshot.hashrateTHs < longAvgHashrateTHs * 0.6) {
    return 'Likely cause: long-term performance drift, dust buildup, or PSU weakness.';
  }

  return 'Likely cause: transient performance instability.';
}

function inferThermalAdvice(snapshot: MinerSnapshot) {
  if (snapshot.tempMax >= 96) {
    return 'Recommended action: reduce power mode immediately and inspect airflow.';
  }
  if (snapshot.tempAvg >= 90) {
    return 'Recommended action: raise fan speed and check dust / room extraction.';
  }
  return 'Recommended action: monitor cooling and verify the fan curve.';
}

async function sendDiscordWebhook(webhook: string, message: string) {
  await fetch(webhook, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: message }),
  });
}

async function sendTelegram(token: string, chatId: string, message: string) {
  const endpoint = `https://api.telegram.org/bot${token}/sendMessage`;
  await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text: message }),
  });
}

async function sendAlert(message: string, settings: AlertSettings) {
  const webhook = settings.webhookUrl;
  const telegramToken = settings.telegramBotToken;
  const telegramChatId = settings.telegramChatId;

  const promises: Promise<unknown>[] = [];

  if (webhook) {
    promises.push(sendDiscordWebhook(webhook, message));
  }
  if (telegramToken && telegramChatId) {
    promises.push(sendTelegram(telegramToken, telegramChatId, message));
  }

  if (promises.length) {
    await Promise.allSettled(promises);
  }
}

function shouldNotify(type: AlertType, overrideKey?: string, overrideCooldownMs?: number): boolean {
  const now = Date.now();
  const key = overrideKey || type;
  const cooldown = overrideCooldownMs ?? cooldownMsByType[type];
  const lastTs = lastAlertAt[key] ?? 0;
  if (now - lastTs < cooldown) return false;
  lastAlertAt[key] = now;
  return true;
}

export async function evaluateAndNotifyAlerts(snapshot: MinerSnapshot, avgHashrateTHs: number) {
  const settings: AlertSettings = {
    thermalThresholdC: Number(process.env.ALERT_TEMP_THRESHOLD_C ?? 90),
    hashrateDropRatio: Number(process.env.ALERT_HASHRATE_DROP_RATIO ?? 0.7),
    anomalyDropRatio: 0.5,
    reportHourLocal: 9,
    autoMaintenanceEnabled: false,
    maintenanceTempC: 92,
    webhookUrl: process.env.ALERT_WEBHOOK_URL,
    telegramBotToken: process.env.ALERT_TELEGRAM_BOT_TOKEN,
    telegramChatId: process.env.ALERT_TELEGRAM_CHAT_ID,
  };

  await evaluateAndNotifyAlertsV2(snapshot, avgHashrateTHs, avgHashrateTHs, settings, { id: 'findmyminers-main', name: 'findmyminers', ip: '', port: 4028, enabled: true });
}

export async function evaluateAndNotifyAlertsV2(
  snapshot: MinerSnapshot,
  avgHashrateTHs: number,
  longAvgHashrateTHs: number,
  settings: AlertSettings,
  miner: MinerNode,
  orgId = 'public',
) {
  const thermalThreshold = settings.thermalThresholdC;
  const hashrateDropRatio = settings.hashrateDropRatio;
  const anomalyDropRatio = settings.anomalyDropRatio;

  if ((snapshot.tempAvg >= thermalThreshold || snapshot.tempMax >= thermalThreshold + 5) && shouldNotify('thermal', `thermal-${miner.id}`)) {
    const msg = [
      `🚨 ${miner.name} Alerte Thermique: ${snapshot.tempAvg.toFixed(1)}°C (max ${snapshot.tempMax.toFixed(1)}°C)`,
      inferThermalAdvice(snapshot),
    ].join(' ');
    await sendAlert(msg, settings);
    await appendAlertEvent({ ts: Date.now(), type: 'thermal', minerId: miner.id, minerName: miner.name, message: msg }, orgId);
    await appendMinerEvent({ ts: Date.now(), type: 'alert-thermal', category: 'alert', severity: 'critical', minerId: miner.id, minerName: miner.name, message: msg }, orgId, { dedupeKey: `${miner.id}:alert-thermal`, dedupeWindowMs: 60_000 });
  }

  if (avgHashrateTHs > 0 && snapshot.hashrateTHs < avgHashrateTHs * hashrateDropRatio && shouldNotify('hashrate-drop', `hashrate-drop-${miner.id}`)) {
    const msg = [
      `⚠️ ${miner.name} Chute Hashrate: ${snapshot.hashrateTHs.toFixed(2)} TH/s (moyenne récente ${avgHashrateTHs.toFixed(2)} TH/s)`,
      inferHashrateCause(snapshot, avgHashrateTHs, longAvgHashrateTHs),
    ].join(' ');
    await sendAlert(msg, settings);
    await appendAlertEvent({ ts: Date.now(), type: 'hashrate-drop', minerId: miner.id, minerName: miner.name, message: msg }, orgId);
    await appendMinerEvent({ ts: Date.now(), type: 'alert-hashrate-drop', category: 'alert', severity: 'warning', minerId: miner.id, minerName: miner.name, message: msg }, orgId, { dedupeKey: `${miner.id}:alert-hashrate-drop`, dedupeWindowMs: 60_000 });
  }

  if (!snapshot.poolAlive && shouldNotify('pool-down', `pool-down-${miner.id}`)) {
    // Pool failover: try to switch to the next pool slot
    let failoverMsg = '';
    try {
      const poolsRes = await sendCgminerCommand(miner.ip, miner.port, 'pools');
      const pools = poolsRes?.POOLS || [];
      const deadIdx = pools.findIndex((p: any) => p['Stratum Active'] === true);
      const nextIdx = deadIdx >= 0 ? (deadIdx + 1) % pools.length : -1;
      if (nextIdx >= 0 && nextIdx !== deadIdx && pools.length > 1) {
        await sendCgminerCommand(miner.ip, miner.port, 'switchpool', String(nextIdx));
        failoverMsg = ` Auto-failover: switched to pool slot ${nextIdx} (${pools[nextIdx]?.URL || 'backup'}).`;
        await appendMinerEvent({ ts: Date.now(), type: 'pool-failover', category: 'action', severity: 'warning', minerId: miner.id, minerName: miner.name, message: `Pool failover to slot ${nextIdx}` }, orgId, { dedupeKey: `${miner.id}:pool-failover`, dedupeWindowMs: 120_000 });
      }
    } catch { /* failover is best-effort */ }

    const msg = `⛔ ${miner.name} Pool Down: aucun pool actif détecté. Likely cause: upstream pool outage, DNS issue, or local network instability.${failoverMsg}`;
    await sendAlert(msg, settings);
    await appendAlertEvent({ ts: Date.now(), type: 'pool-down', minerId: miner.id, minerName: miner.name, message: msg }, orgId);
    await appendMinerEvent({ ts: Date.now(), type: 'alert-pool-down', category: 'alert', severity: 'critical', minerId: miner.id, minerName: miner.name, message: msg }, orgId, { dedupeKey: `${miner.id}:alert-pool-down`, dedupeWindowMs: 60_000 });
  }

  if (longAvgHashrateTHs > 0 && snapshot.hashrateTHs < longAvgHashrateTHs * anomalyDropRatio && shouldNotify('anomaly', `anomaly-${miner.id}`)) {
    const msg = [
      `🧠 ${miner.name} Anomalie détectée: hashrate ${snapshot.hashrateTHs.toFixed(2)} TH/s vs baseline ${longAvgHashrateTHs.toFixed(2)} TH/s.`,
      inferHashrateCause(snapshot, avgHashrateTHs, longAvgHashrateTHs),
    ].join(' ');
    await sendAlert(msg, settings);
    await appendAlertEvent({ ts: Date.now(), type: 'anomaly', minerId: miner.id, minerName: miner.name, message: msg }, orgId);
    await appendMinerEvent({ ts: Date.now(), type: 'alert-anomaly', category: 'alert', severity: 'warning', minerId: miner.id, minerName: miner.name, message: msg }, orgId, { dedupeKey: `${miner.id}:alert-anomaly`, dedupeWindowMs: 60_000 });
  }
}

export async function maybeSendDailyReport(
  miner: MinerNode,
  stats: {
    avgHashrate: number;
    avgTemp: number;
    netEurDaily: number;
    uptimeRatio: number;
  },
  settings: AlertSettings,
  orgId = 'public',
) {
  const now = new Date();
  if (now.getHours() !== settings.reportHourLocal) return;

  const key = `daily-report-${miner.id}-${now.toISOString().slice(0, 10)}`;
  if (!shouldNotify('daily-report', key, 24 * 60 * 60 * 1000)) return;

  const message = [
    `📊 Rapport quotidien ${miner.name}`,
    `• Hashrate moyen: ${stats.avgHashrate.toFixed(2)} TH/s`,
    `• Temp moyenne: ${stats.avgTemp.toFixed(1)} °C`,
    `• Uptime pool: ${(stats.uptimeRatio * 100).toFixed(1)} %`,
    `• Net estimé: ${stats.netEurDaily >= 0 ? '+' : ''}${stats.netEurDaily.toFixed(2)} €/j`,
  ].join('\n');

  await sendAlert(message, settings);
  await appendAlertEvent({ ts: Date.now(), type: 'daily-report', minerId: miner.id, minerName: miner.name, message }, orgId);
  await appendMinerEvent({ ts: Date.now(), type: 'alert-daily-report', category: 'alert', severity: 'info', minerId: miner.id, minerName: miner.name, message }, orgId, { dedupeKey: `${miner.id}:alert-daily-report:${now.toISOString().slice(0, 10)}`, dedupeWindowMs: 24 * 60 * 60 * 1000 });
}
