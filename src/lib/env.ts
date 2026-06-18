/**
 * Centralized environment variable access with defaults and startup validation.
 * Import this module early to surface missing configuration.
 */

function num(key: string, fallback: number): number {
  const raw = process.env[key];
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function str(key: string, fallback = ''): string {
  return process.env[key] || fallback;
}

export const env = {
  // Alert thresholds
  alertTempThresholdC: num('ALERT_TEMP_THRESHOLD_C', 90),
  alertHashrateDropRatio: num('ALERT_HASHRATE_DROP_RATIO', 0.7),

  // Notification channels (optional)
  alertWebhookUrl: str('ALERT_WEBHOOK_URL'),
  alertTelegramBotToken: str('ALERT_TELEGRAM_BOT_TOKEN'),
  alertTelegramChatId: str('ALERT_TELEGRAM_CHAT_ID'),

  // Profitability defaults
  elecCostEurKwh: num('ELEC_COST_EUR_KWH', 0.25),
  poolFeePct: num('POOL_FEE_PCT', 2),

  // Agent communication
  agentSharedKey: str('AGENT_SHARED_KEY'),

  // Web Push (optional)
  webPushPublicKey: str('WEB_PUSH_PUBLIC_KEY'),
  webPushPrivateKey: str('WEB_PUSH_PRIVATE_KEY'),
  webPushSubject: str('WEB_PUSH_SUBJECT', 'mailto:noreply@findmyminers.local'),

  isProduction: process.env.NODE_ENV === 'production',
} as const;

/** Log warnings for recommended-but-missing env vars. Called once at import time. */
function validateOnce() {
  const recommended = [
    ['AGENT_SHARED_KEY', env.agentSharedKey, 'Agent ingest/heartbeat endpoints will reject requests'],
  ] as const;

  for (const [key, value, impact] of recommended) {
    if (!value) {
      console.warn(`[env] ⚠ ${key} is not set — ${impact}`);
    }
  }
}

validateOnce();
