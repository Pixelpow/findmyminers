import type { NextApiRequest, NextApiResponse } from 'next';
import { requireAuth } from '@/server/saas-auth';
import { readDashboardConfig } from '@/server/miner-config';
import { executeMinerAction } from '@/server/miner-actions';
import { appendMinerEvent } from '@/server/event-history';

/**
 * POST /api/miner/night-mode
 * Applies or reverts night mode settings to all enabled miners.
 * Called manually or by a cron / interval to enforce the schedule.
 *
 * Body: { apply: boolean }  — true = apply night settings, false = revert to normal
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const auth = await requireAuth(req, res);
  if (!auth) return;

  const orgId = auth.organization.id;
  const config = await readDashboardConfig(orgId);
  const schedule = config.nightSchedule;

  if (!schedule?.enabled) {
    return res.status(200).json({ applied: false, reason: 'Night schedule is disabled' });
  }

  const { apply } = req.body || {};
  const enabledMiners = config.miners.filter((m) => m.enabled);
  const results: { minerId: string; name: string; ok: boolean; error?: string }[] = [];

  for (const miner of enabledMiners) {
    try {
      if (apply) {
        // Apply night mode: set fan speed + work mode
        await executeMinerAction({ miner, orgId, action: 'fan', value: String(schedule.fanPercent) });
        await executeMinerAction({ miner, orgId, action: 'mode', value: schedule.workMode });
        await appendMinerEvent({
          ts: Date.now(), type: 'night-mode-on', category: 'action', severity: 'info',
          minerId: miner.id, minerName: miner.name,
          message: `Night mode applied: fan ${schedule.fanPercent}%, mode ${schedule.workMode === '0' ? 'low' : schedule.workMode === '2' ? 'high' : 'normal'}`,
        }, orgId, { dedupeKey: `${miner.id}:night-mode-on`, dedupeWindowMs: 60_000 });
      } else {
        // Revert to normal: mode=1 (normal), fan=100%
        await executeMinerAction({ miner, orgId, action: 'mode', value: '1' });
        await executeMinerAction({ miner, orgId, action: 'fan', value: '100' });
        await appendMinerEvent({
          ts: Date.now(), type: 'night-mode-off', category: 'action', severity: 'info',
          minerId: miner.id, minerName: miner.name,
          message: 'Night mode reverted: fan 100%, mode normal',
        }, orgId, { dedupeKey: `${miner.id}:night-mode-off`, dedupeWindowMs: 60_000 });
      }
      results.push({ minerId: miner.id, name: miner.name, ok: true });
    } catch (err: any) {
      results.push({ minerId: miner.id, name: miner.name, ok: false, error: err.message });
    }
  }

  return res.status(200).json({ applied: apply, results });
}
