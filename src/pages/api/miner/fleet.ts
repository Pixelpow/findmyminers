import type { NextApiRequest, NextApiResponse } from 'next';
import { requireAuth } from '@/server/saas-auth';
import { readDashboardConfig } from '@/server/miner-config';
import { sendCgminerCommand } from '@/server/cgminer';
import { appendTelemetry, readTelemetry, average, getPointsForRange, type MinerSnapshot } from '@/server/telemetry-store';
import { computeProfitability } from '@/server/profitability';
import { computeHealthScore } from '@/server/health-score';
import { recordDiffSample } from '@/server/miner-diff-db';
import { notifyRecordDiffChanges } from '@/server/push-notifications';
import { pollMiner, getDriverForMiner } from '@/server/drivers';
import { ensureMinerProtocols } from '@/server/detect-protocols';

/**
 * In-memory tracking of when miners were last seen online (for auto-reboot).
 * Key: orgId:minerId, Value: timestamp of last online poll.
 */
const lastSeenOnline: Record<string, number> = {};
const rebootAttempted: Record<string, number> = {};
const AUTO_REBOOT_OFFLINE_MS = 5 * 60 * 1000; // 5 minutes
const REBOOT_COOLDOWN_MS = 30 * 60 * 1000; // 30 min between reboot attempts

/**
 * Cache serveur par organisation : le dashboard (3 s), la page mineurs (10 s)
 * et le layout (60 s) interrogent tous cette route — sans cache, chaque
 * requête déclenche un poll TCP/HTTP complet du matériel. On sert le dernier
 * snapshot pendant FLEET_CACHE_TTL_MS et on mutualise les requêtes
 * concurrentes sur une seule promesse de poll.
 */
const FLEET_CACHE_TTL_MS = 3_000;
const fleetCache = new Map<string, { ts: number; payload: unknown }>();
const fleetInFlight = new Map<string, Promise<unknown>>();

/** Estimate noise level in dB from fan RPM (rough approximation for ASIC miners). */
function estimateNoisedB(fanRpm: number): number {
  if (!fanRpm || fanRpm <= 0) return 0;
  // Typical ASIC fan: ~30dB at 1000 RPM, scales logarithmically to ~75dB at 6000+ RPM
  const dB = 20 + 15 * Math.log10(Math.max(fanRpm, 100) / 100);
  return Math.round(Math.min(dB, 85) * 10) / 10;
}

/** Downsample an array to at most `maxPoints` evenly spaced entries. */
function downsample(arr: number[], maxPoints: number): number[] {
  if (arr.length <= maxPoints) return arr;
  const step = arr.length / maxPoints;
  const result: number[] = [];
  for (let i = 0; i < maxPoints; i++) {
    result.push(arr[Math.floor(i * step)]);
  }
  return result;
}

/**
 * GET /api/miner/fleet
 * Actively polls all configured miners via CGMiner in parallel,
 * stores telemetry, and returns live data + historical stats.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Demo mode: return mock fleet data
  if (process.env.DEMO_MODE === '1') {
    const { DEMO_FLEET } = await import('@/server/demo-data');
    return res.status(200).json(DEMO_FLEET);
  }

  const auth = await requireAuth(req, res);
  if (!auth) return;

  const orgId = auth.organization.id;

  try {
    const cached = fleetCache.get(orgId);
    if (cached && Date.now() - cached.ts < FLEET_CACHE_TTL_MS) {
      return res.status(200).json(cached.payload);
    }

    let pending = fleetInFlight.get(orgId);
    if (!pending) {
      pending = buildFleetPayload(orgId)
        .then((payload) => {
          fleetCache.set(orgId, { ts: Date.now(), payload });
          return payload;
        })
        .finally(() => fleetInFlight.delete(orgId));
      fleetInFlight.set(orgId, pending);
    }

    return res.status(200).json(await pending);
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : 'Fleet overview failed' });
  }
}

/** Poll complet de la flotte d'une organisation (matériel + stats + agrégats). */
async function buildFleetPayload(orgId: string) {
  {
    const config = await readDashboardConfig(orgId);
    // Backfill protocol for legacy miners so badges + control route correctly.
    const enabledMiners = await ensureMinerProtocols(orgId, config.miners.filter((m) => m.enabled));

    // Poll all miners in parallel for live data (routed through their driver)
    const liveResults = await Promise.all(
      enabledMiners.map((miner) => pollMiner(miner).catch(() => null)),
    );

    const fleet = await Promise.all(
      enabledMiners.map(async (miner, i) => {
        const live = liveResults[i];
        let latest: MinerSnapshot | null = null;
        let online = false;
        let poolUrl = '';
        let model = miner.model;
        let accountKey = '';
        let frequencyMHz = 0;
        let coreVoltageMV = 0;
        let fanRpm = 0;
        const minerKey = `${orgId}:${miner.id}`;

        if (live) {
          // Miner responded — store telemetry and use live data
          latest = live.snapshot;
          online = true;
          poolUrl = live.poolUrl || '';
          accountKey = live.accountKey || '';
          if (live.model) model = live.model;
          if (live.frequencyMHz) frequencyMHz = live.frequencyMHz;
          if (live.coreVoltageMV) coreVoltageMV = live.coreVoltageMV;
          if (live.fanRpm) fanRpm = live.fanRpm;
          lastSeenOnline[minerKey] = Date.now();
          await appendTelemetry(miner.id, live.snapshot, orgId).catch(() => {});
          const diffChanges = recordDiffSample({
            orgId,
            minerId: miner.id,
            minerName: miner.name,
            accountKey: live.accountKey || '',
            poolUrl: live.poolUrl || '',
            source: live.source,
            bestDiff: live.snapshot.bestShare,
            lastDiff: live.snapshot.lastDiff,
            diffAccepted: live.snapshot.diffAccepted,
            diffRejected: live.snapshot.diffRejected,
            ts: live.snapshot.ts,
          });
          await notifyRecordDiffChanges(orgId, diffChanges);
        } else {
          // Miner offline — use cached telemetry
          const history = await readTelemetry(miner.id, orgId);
          latest = history[history.length - 1] || null;
          online = false;

          // Auto-reboot: if miner was online recently and now offline > 5 min
          if (config.autoReboot?.enabled && !config.vacationMode?.enabled) {
            const lastSeen = lastSeenOnline[minerKey];
            const lastReboot = rebootAttempted[minerKey] || 0;
            if (lastSeen && (Date.now() - lastSeen > AUTO_REBOOT_OFFLINE_MS) && (Date.now() - lastReboot > REBOOT_COOLDOWN_MS)) {
              rebootAttempted[minerKey] = Date.now();
              sendCgminerCommand(miner.ip, miner.port, 'restart').catch(() => {});
            }
          }
        }

        // Historical stats
        const history = await readTelemetry(miner.id, orgId);
        const last24h = getPointsForRange(history, '24h');
        const avgHashrate24h = average(last24h.map((p) => p.hashrateTHs));
        const avgTemp24h = average(last24h.map((p) => p.tempAvg));
        const uptimeRatio = last24h.length
          ? last24h.filter((p) => p.poolAlive).length / last24h.length
          : 0;

        let profitability = null;
        if (latest) {
          try {
            profitability = await computeProfitability({
              hashrateTHs: latest.hashrateTHs,
              powerW: latest.powerW,
              elecCostEurKwh: config.profitability.elecCostEurKwh,
              poolFeePct: config.profitability.poolFeePct,
            });
          } catch { /* ignore */ }
        }

        const healthScore = computeHealthScore(last24h);

        // Sparkline: downsample 24h hashrate to ~48 points
        const sparkline24h = downsample(last24h.map((p) => p.hashrateTHs), 48);

        // Luck: bestShare / lastDiff (higher = luckier)
        const bestShare = latest?.bestShare || 0;
        const lastDiff = latest?.lastDiff || 0;
        const luck = lastDiff > 0 ? bestShare / lastDiff : 0;

        // Noise estimation from fan RPM
        const noisedB = estimateNoisedB(fanRpm);

        // Maintenance: days since last recorded maintenance
        const daysSinceMaintenance = miner.lastMaintenanceTs
          ? Math.floor((Date.now() - miner.lastMaintenanceTs) / (24 * 60 * 60 * 1000))
          : undefined;

        const driver = getDriverForMiner(miner);

        return {
          id: miner.id,
          name: miner.name,
          ip: miner.ip,
          port: miner.port,
          protocol: driver.protocol,
          driverLabel: driver.label,
          capabilities: driver.capabilities,
          managedBy: miner.managedBy || 'direct',
          model,
          online,
          poolUrl,
          accountKey: accountKey || undefined,
          latest,
          frequencyMHz: frequencyMHz || undefined,
          coreVoltageMV: coreVoltageMV || undefined,
          fanRpm: fanRpm || undefined,
          noisedB: noisedB || undefined,
          luck: luck || undefined,
          sparkline24h,
          daysSinceMaintenance,
          lastMaintenanceTs: miner.lastMaintenanceTs || undefined,
          stats: {
            avgHashrate24h,
            avgTemp24h,
            uptimeRatio,
            totalPoints24h: last24h.length,
            healthScore,
          },
          profitability: profitability
            ? {
                dailyNetEur: profitability.dailyNetEur,
                dailyBtc: profitability.dailyBtc,
                dailyElecCostEur: profitability.dailyElecCostEur,
              }
            : null,
        };
      }),
    );

    // Aggregate fleet totals
    const totalHashrate = fleet.reduce((sum, m) => sum + (m.latest?.hashrateTHs || 0), 0);
    const totalPower = fleet.reduce((sum, m) => sum + (m.latest?.powerW || 0), 0);
    const totalDailyNetEur = fleet.reduce((sum, m) => sum + (m.profitability?.dailyNetEur || 0), 0);
    const totalDailyBtc = fleet.reduce((sum, m) => sum + (m.profitability?.dailyBtc || 0), 0);
    const onlineCount = fleet.filter((m) => m.online).length;
    const withTemp = fleet.filter((m) => m.latest && m.latest.tempAvg > 0);
    const avgTemp = withTemp.length
      ? withTemp.reduce((sum, m) => sum + (m.latest?.tempAvg || 0), 0) / withTemp.length
      : 0;

    // Cumulative sats stacked (aggregate diffAccepted across fleet)
    const totalDiffAccepted = fleet.reduce((sum, m) => sum + (m.latest?.diffAccepted || 0), 0);
    const totalAccepted = fleet.reduce((sum, m) => sum + (m.latest?.accepted || 0), 0);
    const bestShareFleet = Math.max(0, ...fleet.map((m) => m.latest?.bestShare || 0));

    // Determine if night mode is currently active
    let nightModeActive = false;
    const ns = config.nightSchedule;
    if (ns?.enabled) {
      const hour = new Date().getHours();
      if (ns.startHour > ns.endHour) {
        // Overnight range, e.g. 22:00 -> 07:00
        nightModeActive = hour >= ns.startHour || hour < ns.endHour;
      } else {
        nightModeActive = hour >= ns.startHour && hour < ns.endHour;
      }
    }

    return {
      fleet,
      totals: {
        miners: fleet.length,
        online: onlineCount,
        offline: fleet.length - onlineCount,
        hashrateTHs: totalHashrate,
        powerW: totalPower,
        dailyNetEur: totalDailyNetEur,
        dailyBtc: totalDailyBtc,
        avgTempC: avgTemp,
        totalDiffAccepted,
        totalAccepted,
        bestShareFleet,
      },
      nightModeActive,
      vacationMode: config.vacationMode?.enabled || false,
      autoReboot: config.autoReboot?.enabled || false,
    };
  }
}
