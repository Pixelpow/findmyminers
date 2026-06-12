import fs from 'fs';
import path from 'path';
import * as webpush from 'web-push';
import { deletePushSubscription, listPushSubscriptions, savePushSubscription } from './app-store-db';
import type { RecordDiffChanges } from './miner-diff-db';

type StoredPushSubscription = {
  endpoint: string;
  expirationTime?: number | null;
  keys?: {
    p256dh?: string;
    auth?: string;
  };
};

type VapidConfig = {
  publicKey: string;
  privateKey: string;
};

const DATA_DIR = path.join(process.cwd(), 'data');
const VAPID_FILE = path.join(DATA_DIR, 'push-vapid.json');
let vapidConfig: VapidConfig | null = null;

function loadOrCreateVapidConfig(): VapidConfig {
  if (vapidConfig) return vapidConfig;

  const envPublic = process.env.WEB_PUSH_PUBLIC_KEY;
  const envPrivate = process.env.WEB_PUSH_PRIVATE_KEY;

  if (envPublic && envPrivate) {
    vapidConfig = { publicKey: envPublic, privateKey: envPrivate };
  } else {
    fs.mkdirSync(DATA_DIR, { recursive: true });

    if (fs.existsSync(VAPID_FILE)) {
      vapidConfig = JSON.parse(fs.readFileSync(VAPID_FILE, 'utf-8')) as VapidConfig;
    } else {
      vapidConfig = webpush.generateVAPIDKeys();
      fs.writeFileSync(VAPID_FILE, JSON.stringify(vapidConfig, null, 2), 'utf-8');
    }
  }

  webpush.setVapidDetails(process.env.WEB_PUSH_SUBJECT || 'mailto:noreply@findmyminers.local', vapidConfig.publicKey, vapidConfig.privateKey);
  return vapidConfig;
}

function isValidSubscription(subscription: StoredPushSubscription | null | undefined): subscription is StoredPushSubscription {
  return !!subscription && typeof subscription.endpoint === 'string' && !!subscription.endpoint.trim();
}

export function getPushPublicKey() {
  return loadOrCreateVapidConfig().publicKey;
}

export function registerPushSubscription(orgId: string, subscription: StoredPushSubscription) {
  if (!isValidSubscription(subscription)) {
    throw new Error('Invalid push subscription');
  }

  loadOrCreateVapidConfig();
  savePushSubscription(orgId, subscription);
}

export function unregisterPushSubscription(orgId: string, endpoint: string) {
  if (!endpoint?.trim()) return;
  deletePushSubscription(orgId, endpoint.trim());
}

export async function sendPushNotificationToOrg(
  orgId: string,
  payload: { title: string; body: string; url?: string; tag?: string },
) {
  loadOrCreateVapidConfig();

  const subscriptions = listPushSubscriptions(orgId);
  await Promise.allSettled(subscriptions.map(async (subscription) => {
    try {
      await webpush.sendNotification(subscription as webpush.PushSubscription, JSON.stringify(payload));
    } catch (error) {
      const statusCode = typeof error === 'object' && error && 'statusCode' in error ? Number((error as { statusCode?: number }).statusCode) : 0;
      if (statusCode === 404 || statusCode === 410) {
        deletePushSubscription(orgId, subscription.endpoint);
      }
    }
  }));
}

export async function notifyRecordDiffChanges(orgId: string, changes: RecordDiffChanges) {
  if (!changes.newAccountBest && !changes.newMinerBest && !changes.newGlobalBest) {
    return;
  }

  if (changes.newGlobalBest) {
    await sendPushNotificationToOrg(orgId, {
      title: 'New fleet diff record',
      body: `${changes.minerName} reached ${changes.bestDiff.toLocaleString()} diff on ${changes.accountKey}.`,
      url: '/records',
      tag: `fleet-record-${changes.minerId}`,
    });
    return;
  }

  if (changes.newMinerBest) {
    await sendPushNotificationToOrg(orgId, {
      title: 'New miner personal best',
      body: `${changes.minerName} set a new best diff of ${changes.bestDiff.toLocaleString()}.`,
      url: `/miners/${changes.minerId}`,
      tag: `miner-record-${changes.minerId}`,
    });
    return;
  }

  await sendPushNotificationToOrg(orgId, {
    title: 'New account diff best',
    body: `${changes.accountKey} improved to ${changes.bestDiff.toLocaleString()} diff on ${changes.minerName}.`,
    url: `/miners/${changes.minerId}`,
    tag: `account-record-${changes.minerId}-${changes.accountKey}`,
  });
}