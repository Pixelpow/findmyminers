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
      title: 'Dérive thermique détectée',
      message: `Température moyenne en hausse de ${temperatureRise.toFixed(1)}°C alors que le hashrate est resté stable. Flux d'air obstrué ou encrassement probable.`,
    });
  }

  if (efficiencyDropRatio >= 0.08 && recentPower > 0 && baselinePower > 0) {
    insights.push({
      id: 'efficiency-drop',
      severity: efficiencyDropRatio >= 0.15 ? 'critical' : 'warning',
      title: 'Dégradation d’efficacité',
      message: `Le hashrate par watt a baissé de ${(efficiencyDropRatio * 100).toFixed(1)}% par rapport à la baseline. Vérifie le refroidissement, le mode de puissance et la ventilation.`,
    });
  }

  if (recentHashrateCv >= 0.12) {
    insights.push({
      id: 'hashrate-instability',
      severity: recentHashrateCv >= 0.2 ? 'critical' : 'warning',
      title: 'Hashrate instable',
      message: `Les variations récentes de hashrate sont élevées (${(recentHashrateCv * 100).toFixed(1)}% de variation). Cela traduit souvent un throttling thermique, une pool instable ou des réglages limites.`,
    });
  }

  if (baselineUptime - recentUptime >= 0.08 && recentUptime < 0.95) {
    insights.push({
      id: 'uptime-drop',
      severity: recentUptime < 0.8 ? 'critical' : 'warning',
      title: 'Baisse de fiabilité',
      message: `L'uptime pool sur la fenêtre récente est tombé à ${(recentUptime * 100).toFixed(1)}%, contre ${(baselineUptime * 100).toFixed(1)}% avant. Vérifie le réseau, le failover de pool et l'alimentation.`,
    });
  }

  if (!insights.length && recent.length >= 24 && recentTemp > 0 && recentHashrate > 0) {
    insights.push({
      id: 'healthy-baseline',
      severity: 'info',
      title: 'Aucun signal de maintenance',
      message: 'Thermique, efficacité et uptime récents sont stables par rapport à la baseline du mineur.',
    });
  }

  return insights;
}