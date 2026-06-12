import { NextApiRequest, NextApiResponse } from 'next';
import { evaluateAndNotifyAlertsV2, maybeSendDailyReport } from '@/server/alerts';
import { getMinerById, readDashboardConfig } from '@/server/miner-config';
import { sendCgminerCommand } from '@/server/cgminer';
import { pollAxeOs } from '@/server/axeos';
import { appendTelemetry, average, getPointsForRange, readTelemetry } from '@/server/telemetry-store';
import { requireAuth } from '@/server/saas-auth';
import { computeProfitability } from '@/server/profitability';
import { normaliseName } from '@/server/discover-miners';
import { appendMinerEvent } from '@/server/event-history';
import { computeMaintenanceInsights } from '@/server/maintenance-insights';
import { extractAccountKeyFromMiningData, readMinerDiffSummary, recordDiffSample } from '@/server/miner-diff-db';
import { notifyRecordDiffChanges } from '@/server/push-notifications';

const OFFLINE_COOLDOWN_MS = 20_000;
const offlineCooldownByMiner = new Map<string, number>();
const lastKnownStatusByMiner = new Map<string, 'online' | 'offline'>();

function parseMMID0(mmId0String: string) {
    const parsed: any = {};
    // MM ID0 format: Key[Value] Key2[Value2]
    const matches = mmId0String.match(/([a-zA-Z0-9_]+)\[(.*?)\]/g);
    if (matches) {
        matches.forEach(m => {
            const kv = m.match(/([a-zA-Z0-9_]+)\[(.*?)\]/);
            if (kv) parsed[kv[1]] = kv[2];
        });
    }
    return parsed;
}

function toNumber(value: unknown): number | null {
    if (value === null || value === undefined || value === '') return null;
    const num = Number(value);
    return Number.isFinite(num) ? num : null;
}

function extractThermalFromDevs(devsData: any[]): { tempAvg: number; tempMax: number; fanRpm: number } {
    const temps: number[] = [];
    const fans: number[] = [];

    for (const dev of devsData || []) {
        const keys = Object.keys(dev || {});

        for (const key of keys) {
            if (/^Temperature|^Temp\d*|^Chip\s*Temp/i.test(key)) {
                const v = toNumber(dev[key]);
                if (v !== null && v > 0) temps.push(v);
            }

            if (/Fan|RPM/i.test(key)) {
                const v = toNumber(dev[key]);
                if (v !== null && v > 0) fans.push(v);
            }
        }
    }

    const tempAvg = temps.length ? temps.reduce((a, b) => a + b, 0) / temps.length : 0;
    const tempMax = temps.length ? Math.max(...temps) : 0;
    const fanRpm = fans.length ? Math.max(...fans) : 0;

    return { tempAvg, tempMax, fanRpm };
}

async function buildOfflinePayload(miner: any, orgId: string, reason: string) {
    const history = await readTelemetry(miner.id, orgId);
    const latest = history[history.length - 1];
    const maintenanceInsights = computeMaintenanceInsights(history);
    const diffRecords = readMinerDiffSummary(orgId, miner.id);

    if (!latest) {
        return {
            miner,
            offline: true,
            source: 'offline-no-cache',
            summary: {
                'MHS 1m': 0,
                Accepted: 0,
                Rejected: 0,
                Stale: 0,
                'Best Share': 0,
                'Difficulty Accepted': 0,
                'Difficulty Rejected': 0,
                'Hardware Errors': 0,
                Elapsed: 0,
            },
            devs: [],
            pools: [
                {
                    Status: 'Dead',
                    'Stratum Active': false,
                    'Last Share Difficulty': 0,
                },
            ],
            hardware: {
                TAvg: 0,
                TMax: 0,
                FanR: 0,
            },
            rawStats: {
                fallbackReason: reason,
                cacheAvailable: false,
            },
            maintenanceInsights,
            diffRecords,
        };
    }

    return {
        miner,
        offline: true,
        source: 'telemetry-cache',
        summary: {
            'MHS 1m': latest.hashrateTHs * 1_000_000,
            Accepted: latest.accepted,
            Rejected: latest.rejected,
            Stale: latest.stale,
            'Best Share': latest.bestShare,
            'Difficulty Accepted': latest.diffAccepted,
            'Difficulty Rejected': latest.diffRejected,
            'Hardware Errors': latest.hardwareErrors,
            Elapsed: 0,
        },
        devs: [],
        pools: [
            {
                Status: latest.poolAlive ? 'Alive' : 'Dead',
                'Stratum Active': latest.poolAlive,
                'Last Share Difficulty': latest.lastDiff,
            },
        ],
        hardware: {
            TAvg: latest.tempAvg,
            TMax: latest.tempMax,
            FanR: 0,
        },
        rawStats: {
            lastTelemetryTs: latest.ts,
            fallbackReason: reason,
            cacheAvailable: true,
        },
        maintenanceInsights,
        diffRecords,
    };
}

async function trackMinerStatus(orgId: string, miner: { id: string; name: string }, nextStatus: 'online' | 'offline', message: string) {
    const statusKey = `${orgId}:${miner.id}`;
    const previousStatus = lastKnownStatusByMiner.get(statusKey);

    if (previousStatus === nextStatus) {
        return;
    }

    lastKnownStatusByMiner.set(statusKey, nextStatus);

    const type = nextStatus === 'offline'
        ? 'status-offline'
        : previousStatus === 'offline'
            ? 'status-recovered'
            : 'status-online';
    const severity = nextStatus === 'offline' ? 'warning' : previousStatus === 'offline' ? 'success' : 'info';

    await appendMinerEvent({
        ts: Date.now(),
        type,
        category: 'system',
        severity,
        minerId: miner.id,
        minerName: miner.name,
        message,
    }, orgId, { dedupeKey: `${miner.id}:${type}`, dedupeWindowMs: 30_000 });
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const auth = await requireAuth(req, res);
    if (!auth) return;

    const orgId = auth.organization.id;
    const requestedMinerId = typeof req.query.minerId === 'string' ? req.query.minerId : undefined;
    let miner: Awaited<ReturnType<typeof getMinerById>> | null = null;

    try {
        const [config, resolvedMiner] = await Promise.all([
            readDashboardConfig(orgId),
            getMinerById(requestedMinerId, orgId),
        ]);
        miner = resolvedMiner;

        const cooldownKey = `${orgId}:${miner.id}`;
        const cooldownUntil = offlineCooldownByMiner.get(cooldownKey) || 0;
        if (Date.now() < cooldownUntil) {
            await trackMinerStatus(orgId, miner, 'offline', `${miner.name} is in offline cooldown after repeated polling failures.`);
            const payload = await buildOfflinePayload(miner, orgId, 'Miner in offline cooldown window');
            return res.status(200).json(payload);
        }

        /* ------------------------------------------------------------------ */
        /*  Try CGMiner TCP first, fallback to AxeOS HTTP                     */
        /* ------------------------------------------------------------------ */
        let summaryData: any = null;
        let devsData: any[] = [];
        let poolsData: any[] = [];
        let minerStats: any = {};
        let hardwareDetails: any = {};
        let model: string | undefined;
        let firmware: string | undefined;
        let description: string | undefined;
        let hashrateTHs = 0;
        let tempAvg = 0;
        let tempMax = 0;
        let fanRpm = 0;
        let powerW = 0;
        let activePool: any = null;
        let source: 'cgminer' | 'axeos' = 'cgminer';
        let axeOsRaw: any = null;
        let activeAccountKey = '';

        let cgminerOk = false;
        try {
            const [summary, devs, stats, pools, version] = await Promise.all([
                sendCgminerCommand(miner.ip, miner.port, 'summary'),
                sendCgminerCommand(miner.ip, miner.port, 'devs'),
                sendCgminerCommand(miner.ip, miner.port, 'stats'),
                sendCgminerCommand(miner.ip, miner.port, 'pools'),
                sendCgminerCommand(miner.ip, miner.port, 'version'),
            ]);

            summaryData = summary?.SUMMARY?.[0] ?? null;
            if (summaryData) {
                cgminerOk = true;
                const versionData = version?.VERSION?.[0] ?? {};
                const rawModel = String(versionData.Model || versionData.MODEL || '').trim();
                const rawDesc = String(versionData.Description || versionData.DESC || '').trim();
                const rawFw = String(versionData.FW || versionData.Firmware || versionData.CGMiner || '').trim();
                model = normaliseName(rawModel, rawDesc, rawFw) || rawModel || undefined;
                firmware = rawFw || undefined;
                description = rawDesc || undefined;

                minerStats = stats?.STATS?.[0] ?? {};
                hardwareDetails = minerStats['MM ID0'] ? parseMMID0(minerStats['MM ID0']) : {};
                devsData = devs?.DEVS || [];
                const devThermal = extractThermalFromDevs(devsData);

                poolsData = pools?.POOLS || [];
                activePool = poolsData.find((pool: any) => pool['Stratum Active']) || poolsData[0];
                activeAccountKey = extractAccountKeyFromMiningData({ activePool, fallbackPoolUrl: activePool?.URL || '' });

                hashrateTHs = summaryData['MHS 1m'] ? summaryData['MHS 1m'] / 1_000_000 : 0;
                const mmTempAvg = toNumber(hardwareDetails?.TAvg);
                const mmTempMax = toNumber(hardwareDetails?.TMax);
                tempAvg = mmTempAvg ?? (devThermal.tempAvg || 0);
                tempMax = mmTempMax ?? (devThermal.tempMax || tempAvg || 0);
                fanRpm = toNumber(hardwareDetails?.FanR) ?? devThermal.fanRpm;
                powerW = hardwareDetails?.MPO
                    ? parseFloat(hardwareDetails.MPO)
                    : (hardwareDetails?.WORKMODE === '0' ? 65 : hardwareDetails?.WORKMODE === '2' ? 140 : 90);
            }
        } catch {
            cgminerOk = false;
        }

        /* --- AxeOS HTTP fallback --- */
        if (!cgminerOk) {
            const axeResult = await pollAxeOs(miner.ip, 80, 5000);
            if (!axeResult) {
                // Both protocols failed — this miner is truly offline
                const cooldownKey2 = `${orgId}:${miner.id}`;
                offlineCooldownByMiner.set(cooldownKey2, Date.now() + OFFLINE_COOLDOWN_MS);
                await trackMinerStatus(orgId, miner, 'offline', `${miner.name} is offline: CGMiner TCP and AxeOS HTTP both failed.`);
                const payload = await buildOfflinePayload(miner, orgId, 'CGMiner TCP and AxeOS HTTP both failed');
                return res.status(200).json(payload);
            }

            source = 'axeos';
            axeOsRaw = axeResult.raw;
            hashrateTHs = axeResult.snapshot.hashrateTHs;
            tempAvg = axeResult.snapshot.tempAvg;
            tempMax = axeResult.snapshot.tempMax;
            powerW = axeResult.snapshot.powerW;
            fanRpm = axeResult.fanRpm;
            model = axeResult.model;
            firmware = axeResult.firmware;
            description = axeResult.chipType || undefined;
            activeAccountKey = axeResult.accountKey;

            // Build CGMiner-compatible structures for the response
            summaryData = {
                'MHS 1m': hashrateTHs * 1_000_000,
                Accepted: axeResult.snapshot.accepted,
                Rejected: axeResult.snapshot.rejected,
                Stale: axeResult.snapshot.stale,
                'Best Share': axeResult.snapshot.bestShare,
                'Difficulty Accepted': axeResult.snapshot.diffAccepted,
                'Difficulty Rejected': axeResult.snapshot.diffRejected,
                'Hardware Errors': axeResult.snapshot.hardwareErrors,
                Elapsed: axeResult.uptime,
            };

            poolsData = [{
                    URL: axeResult.poolUrl,
                    Status: axeResult.snapshot.poolAlive ? 'Alive' : 'Dead',
                    'Stratum Active': axeResult.snapshot.poolAlive,
                    'Last Share Difficulty': axeResult.snapshot.lastDiff,
                }];
            activePool = poolsData[0];
        }

        const snapshot = {
            ts: Date.now(),
            hashrateTHs,
            tempAvg,
            tempMax,
            powerW,
            bestShare: summaryData?.['Best Share'] || 0,
            lastDiff: activePool?.['Last Share Difficulty'] || 0,
            diffAccepted: summaryData?.['Difficulty Accepted'] || 0,
            diffRejected: summaryData?.['Difficulty Rejected'] || 0,
            stale: summaryData?.Stale || 0,
            rejected: summaryData?.Rejected || 0,
            accepted: summaryData?.Accepted || 0,
            hardwareErrors: summaryData?.['Hardware Errors'] || 0,
            poolAlive: poolsData.some((pool: any) =>
                (pool.Status === 'Alive' && pool['Stratum Active'] === true) ||
                (pool.active === true)
            ),
        };

        await appendTelemetry(miner.id, snapshot, orgId);
        const diffChanges = recordDiffSample({
            orgId,
            minerId: miner.id,
            minerName: miner.name,
            accountKey: activeAccountKey,
            poolUrl: activePool?.URL || '',
            source,
            bestDiff: snapshot.bestShare,
            lastDiff: snapshot.lastDiff,
            diffAccepted: snapshot.diffAccepted,
            diffRejected: snapshot.diffRejected,
            ts: snapshot.ts,
        });
        await notifyRecordDiffChanges(orgId, diffChanges);

        const allHistory = await readTelemetry(miner.id, orgId);
        const maintenanceInsights = computeMaintenanceInsights(allHistory);
        const diffRecords = readMinerDiffSummary(orgId, miner.id);
        const recentWindow = allHistory.slice(-24);
        const longWindow = allHistory.slice(-200);
        const recentAvgHashrate = average(recentWindow.map((item) => item.hashrateTHs));
        const longAvgHashrate = average(longWindow.map((item) => item.hashrateTHs));

        await evaluateAndNotifyAlertsV2(snapshot, recentAvgHashrate, longAvgHashrate, config.alerts, miner, orgId);

        if (config.alerts.autoMaintenanceEnabled && (snapshot.tempAvg >= config.alerts.maintenanceTempC || snapshot.tempMax >= config.alerts.maintenanceTempC + 2)) {
            if (source === 'cgminer') {
                await Promise.allSettled([
                    sendCgminerCommand(miner.ip, miner.port, 'ascset', '0,fan-spd,100'),
                    sendCgminerCommand(miner.ip, miner.port, 'ascset', '0,target-temp,80'),
                ]);
            }
            // AxeOS auto-maintenance not yet implemented (would need HTTP PATCH)
        }

        const last24h = getPointsForRange(allHistory, '24h');
        const avgHashrate24h = average(last24h.map((item) => item.hashrateTHs));
        const avgTemp24h = average(last24h.map((item) => item.tempAvg));
        const uptimeRatio = last24h.length ? last24h.filter((item) => item.poolAlive).length / last24h.length : 0;

        const profitability = await computeProfitability({
            hashrateTHs: avgHashrate24h,
            powerW: snapshot.powerW,
            elecCostEurKwh: config.profitability.elecCostEurKwh,
            poolFeePct: config.profitability.poolFeePct,
        });

        await maybeSendDailyReport(
            miner,
            {
                avgHashrate: avgHashrate24h,
                avgTemp: avgTemp24h,
                netEurDaily: profitability.dailyNetEur,
                uptimeRatio,
            },
            config.alerts,
            orgId,
        );

        offlineCooldownByMiner.delete(cooldownKey);
        await trackMinerStatus(orgId, miner, 'online', `${miner.name} is online via ${source === 'axeos' ? 'AxeOS HTTP' : 'CGMiner TCP'}.`);

        if (config.alerts.autoMaintenanceEnabled && source === 'cgminer' && (snapshot.tempAvg >= config.alerts.maintenanceTempC || snapshot.tempMax >= config.alerts.maintenanceTempC + 2)) {
            await appendMinerEvent({
                ts: Date.now(),
                type: 'maintenance-auto',
                category: 'maintenance',
                severity: 'warning',
                minerId: miner.id,
                minerName: miner.name,
                message: `Automatic maintenance applied: fan 100% and target temp 80°C due to thermal threshold breach.`,
                metadata: {
                    tempAvg: Number(snapshot.tempAvg.toFixed(1)),
                    tempMax: Number(snapshot.tempMax.toFixed(1)),
                },
            }, orgId, { dedupeKey: `${miner.id}:maintenance-auto`, dedupeWindowMs: 10 * 60 * 1000 });
        }

        res.status(200).json({
            miner,
            model,
            firmware,
            description,
            source,
            summary: summaryData,
            devs: devsData,
            pools: poolsData,
            hardware: {
                ...hardwareDetails,
                TAvg: tempAvg,
                TMax: tempMax,
                FanR: fanRpm,
            },
            rawStats: source === 'axeos' ? (axeOsRaw || {}) : minerStats,
            maintenanceInsights,
            diffRecords,
        });
    } catch (error: any) {
        if (!miner) {
            return res.status(500).json({ error: error.message || 'Failed to fetch data from miner' });
        }

        const cooldownKey = `${orgId}:${miner.id}`;
        offlineCooldownByMiner.set(cooldownKey, Date.now() + OFFLINE_COOLDOWN_MS);
        await trackMinerStatus(orgId, miner, 'offline', `${miner.name} direct access failed: ${error.message || 'unknown error'}.`);
        const payload = await buildOfflinePayload(miner, orgId, error.message || 'Direct miner access failed');
        return res.status(200).json(payload);
    }
}
