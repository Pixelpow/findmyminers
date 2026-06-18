import type { MinerSnapshot } from './telemetry-store';

/**
 * Compute a 0–100 health score for a miner based on recent telemetry.
 *
 * Scoring breakdown (100 points total):
 *   - Uptime ratio (30 pts)      — % of snapshots where poolAlive = true
 *   - Hashrate stability (25 pts) — low coefficient of variation = high score
 *   - Temperature (20 pts)       — penalised above 80°C, critical above 95°C
 *   - Rejection rate (15 pts)    — low rejected / total shares = high score
 *   - Hardware errors (10 pts)   — 0 errors = full marks
 */
export function computeHealthScore(snapshots: MinerSnapshot[]): number {
  if (!snapshots.length) return 0;

  // ── Uptime (30 pts) ──
  const aliveCount = snapshots.filter((s) => s.poolAlive).length;
  const uptimeRatio = aliveCount / snapshots.length;
  const uptimeScore = uptimeRatio * 30;

  // ── Hashrate stability (25 pts) ──
  const hashrates = snapshots.map((s) => s.hashrateTHs).filter((h) => h > 0);
  let stabilityScore = 25;
  if (hashrates.length >= 2) {
    const mean = hashrates.reduce((a, b) => a + b, 0) / hashrates.length;
    if (mean > 0) {
      const variance = hashrates.reduce((sum, h) => sum + (h - mean) ** 2, 0) / hashrates.length;
      const cv = Math.sqrt(variance) / mean; // coefficient of variation
      // cv < 0.05 = perfect, cv > 0.5 = bad
      stabilityScore = Math.max(0, 25 * (1 - cv / 0.5));
    }
  } else if (hashrates.length === 0) {
    stabilityScore = 0;
  }

  // ── Temperature (20 pts) ──
  const temps = snapshots.map((s) => s.tempAvg).filter((t) => t > 0);
  let tempScore = 20;
  if (temps.length > 0) {
    const maxTemp = Math.max(...temps);
    const avgTemp = temps.reduce((a, b) => a + b, 0) / temps.length;
    if (maxTemp >= 95) tempScore = 0;
    else if (avgTemp >= 90) tempScore = 4;
    else if (avgTemp >= 85) tempScore = 10;
    else if (avgTemp >= 80) tempScore = 15;
    // else full 20
  }

  // ── Rejection rate (15 pts) ──
  const totalAccepted = snapshots.reduce((sum, s) => sum + s.accepted, 0);
  const totalRejected = snapshots.reduce((sum, s) => sum + s.rejected, 0);
  const totalStale = snapshots.reduce((sum, s) => sum + s.stale, 0);
  const totalShares = totalAccepted + totalRejected + totalStale;
  let rejectScore = 15;
  if (totalShares > 0) {
    const rejectPct = (totalRejected + totalStale) / totalShares;
    // 0% reject = 15, 5%+ = 0
    rejectScore = Math.max(0, 15 * (1 - rejectPct / 0.05));
  }

  // ── Hardware errors (10 pts) ──
  const totalHwErrors = snapshots.reduce((sum, s) => sum + s.hardwareErrors, 0);
  let hwScore = 10;
  if (totalHwErrors > 100) hwScore = 0;
  else if (totalHwErrors > 50) hwScore = 3;
  else if (totalHwErrors > 10) hwScore = 6;
  else if (totalHwErrors > 0) hwScore = 8;

  const total = uptimeScore + stabilityScore + tempScore + rejectScore + hwScore;
  return Math.round(Math.min(100, Math.max(0, total)));
}

/**
 * Returns a colour hex string for a given health score.
 */
export function healthColor(score: number): string {
  if (score >= 80) return '#4ade80'; // green
  if (score >= 60) return '#fb923c'; // orange
  if (score >= 40) return '#f59e0b'; // amber
  return '#f87171';                  // red
}
