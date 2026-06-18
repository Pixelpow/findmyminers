import type { MinerSnapshot } from './telemetry-store';

export type MaintenanceInsightSeverity = 'info' | 'warning' | 'critical';

export type MaintenanceInsight = {
  id: string;
  severity: MaintenanceInsightSeverity;
  title: string;
  message: string;
};

function average(values: number[]) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function coefficientOfVariation(values: number[]) {
  if (values.length < 2) return 0;
  const mean = average(values);
  if (mean <= 0) return 0;
  const variance = average(values.map((value) => (value - mean) ** 2));
  return Math.sqrt(variance) / mean;
}

export function computeMaintenanceInsights(snapshots: MinerSnapshot[]): MaintenanceInsight[] {
  if (snapshots.length < 12) {
    return [];
  }

  const recent = snapshots.slice(-24);
  const baseline = snapshots.slice(-200, -24).length ? snapshots.slice(-200, -24) : snapshots.slice(0, -24);

  if (!recent.length || !baseline.length) {
    return [];
  }

  const recentHashrate = average(recent.map((point) => point.hashrateTHs).filter((value) => value > 0));
  const baselineHashrate = average(baseline.map((point) => point.hashrateTHs).filter((value) => value > 0));
  const recentTemp = average(recent.map((point) => point.tempAvg).filter((value) => value > 0));
  const baselineTemp = average(baseline.map((point) => point.tempAvg).filter((value) => value > 0));
  const recentPower = average(recent.map((point) => point.powerW).filter((value) => value > 0));
  const baselinePower = average(baseline.map((point) => point.powerW).filter((value) => value > 0));
  const recentUptime = recent.filter((point) => point.poolAlive).length / recent.length;
  const baselineUptime = baseline.filter((point) => point.poolAlive).length / baseline.length;
  const recentHashrateCv = coefficientOfVariation(recent.map((point) => point.hashrateTHs).filter((value) => value > 0));

  const recentEfficiency = recentPower > 0 ? recentHashrate / recentPower : 0;
  const baselineEfficiency = baselinePower > 0 ? baselineHashrate / baselinePower : 0;
  const efficiencyDropRatio = baselineEfficiency > 0 ? 1 - (recentEfficiency / baselineEfficiency) : 0;
  const temperatureRise = recentTemp - baselineTemp;
  const hashrateDriftRatio = baselineHashrate > 0 ? (recentHashrate - baselineHashrate) / baselineHashrate : 0;
  const insights: MaintenanceInsight[] = [];

  if (temperatureRise >= 5 && Math.abs(hashrateDriftRatio) <= 0.1) {
    insights.push({
      id: 'thermal-drift',
      severity: temperatureRise >= 8 ? 'critical' : 'warning',
      title: 'Thermal drift detected',
      message: `Average temperature up ${temperatureRise.toFixed(1)}°C while hashrate stayed stable. Likely obstructed airflow or dust buildup.`,
    });
  }

  if (efficiencyDropRatio >= 0.08 && recentPower > 0 && baselinePower > 0) {
    insights.push({
      id: 'efficiency-drop',
      severity: efficiencyDropRatio >= 0.15 ? 'critical' : 'warning',
      title: 'Efficiency degradation',
      message: `Hashrate per watt dropped ${(efficiencyDropRatio * 100).toFixed(1)}% versus baseline. Check cooling, power mode and fans.`,
    });
  }

  if (recentHashrateCv >= 0.12) {
    insights.push({
      id: 'hashrate-instability',
      severity: recentHashrateCv >= 0.2 ? 'critical' : 'warning',
      title: 'Unstable hashrate',
      message: `Recent hashrate variation is high (${(recentHashrateCv * 100).toFixed(1)}% swing). Often points to thermal throttling, an unstable pool, or borderline tuning.`,
    });
  }

  if (baselineUptime - recentUptime >= 0.08 && recentUptime < 0.95) {
    insights.push({
      id: 'uptime-drop',
      severity: recentUptime < 0.8 ? 'critical' : 'warning',
      title: 'Reliability drop',
      message: `Pool uptime over the recent window fell to ${(recentUptime * 100).toFixed(1)}%, down from ${(baselineUptime * 100).toFixed(1)}% before. Check network, pool failover and power.`,
    });
  }

  if (!insights.length && recent.length >= 24 && recentTemp > 0 && recentHashrate > 0) {
    insights.push({
      id: 'healthy-baseline',
      severity: 'info',
      title: 'No maintenance signal',
      message: 'Recent thermal, efficiency and uptime are stable versus the miner baseline.',
    });
  }

  return insights;
}