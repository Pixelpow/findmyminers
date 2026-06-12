export type AdvisorFleetMiner = {
  id: string;
  name: string;
  online: boolean;
  poolUrl?: string;
  latest?: {
    hashrateTHs?: number;
    tempAvg?: number;
    powerW?: number;
    poolAlive?: boolean;
  } | null;
  stats?: {
    healthScore?: number;
    uptimeRatio?: number;
    avgHashrate24h?: number;
  } | null;
  profitability?: {
    dailyNetEur?: number;
    dailyElecCostEur?: number;
  } | null;
};

export type AdvisorRecommendation = {
  id: string;
  severity: 'critical' | 'warning' | 'info';
  title: string;
  detail: string;
  href: string;
  actionLabel: string;
};

export { fmtCompact } from '@/lib/format';

export function buildFleetRecommendations(fleet: AdvisorFleetMiner[], total: number): AdvisorRecommendation[] {
  const items: AdvisorRecommendation[] = [];

  const hottestMiner = fleet
    .filter((miner) => miner.online && (miner.latest?.tempAvg || 0) > 0)
    .sort((left, right) => (right.latest?.tempAvg || 0) - (left.latest?.tempAvg || 0))[0];
  if (hottestMiner && (hottestMiner.latest?.tempAvg || 0) >= 90) {
    items.push({
      id: `thermal-${hottestMiner.id}`,
      severity: 'critical',
      title: `Refroidir ${hottestMiner.name}`,
      detail: `Température moyenne à ${(hottestMiner.latest?.tempAvg || 0).toFixed(0)}°C. Réduis le mode ou force les ventilateurs avant le throttling thermique.`,
      href: `/miners/${hottestMiner.id}`,
      actionLabel: 'Ouvrir le mineur',
    });
  }

  const weakestMiner = fleet
    .filter((miner) => miner.online && (miner.stats?.avgHashrate24h || 0) > 0)
    .sort((left, right) => {
      const leftRatio = (left.latest?.hashrateTHs || 0) / Math.max(1, left.stats?.avgHashrate24h || 1);
      const rightRatio = (right.latest?.hashrateTHs || 0) / Math.max(1, right.stats?.avgHashrate24h || 1);
      return leftRatio - rightRatio;
    })[0];
  if (weakestMiner) {
    const baselineRatio = (weakestMiner.latest?.hashrateTHs || 0) / Math.max(1, weakestMiner.stats?.avgHashrate24h || 1);
    if (baselineRatio < 0.72) {
      items.push({
        id: `hashrate-${weakestMiner.id}`,
        severity: 'warning',
        title: `Inspecter ${weakestMiner.name}`,
        detail: `Le hashrate actuel est à ${(baselineRatio * 100).toFixed(0)}% de sa baseline 24h. Vérifie le pool, la thermique et le tuning.`,
        href: `/miners/${weakestMiner.id}`,
        actionLabel: 'Inspecter',
      });
    }
  }

  const offlineMiner = fleet.find((miner) => !miner.online);
  if (offlineMiner) {
    items.push({
      id: `offline-${offlineMiner.id}`,
      severity: 'warning',
      title: `${offlineMiner.name} est hors ligne`,
      detail: 'Vérifie la connectivité, l’alimentation ou la carte de contrôle avant que l’uptime ne se dégrade davantage.',
      href: `/miners/${offlineMiner.id}`,
      actionLabel: 'Ouvrir le mineur',
    });
  }

  const unstableMiner = fleet
    .filter((miner) => miner.online)
    .sort((left, right) => (left.stats?.healthScore || 0) - (right.stats?.healthScore || 0))[0];
  if (unstableMiner && (unstableMiner.stats?.healthScore || 0) < 55) {
    items.push({
      id: `health-${unstableMiner.id}`,
      severity: 'info',
      title: `Planifier la maintenance de ${unstableMiner.name}`,
      detail: `Score de santé à ${unstableMiner.stats?.healthScore || 0}/100. Un dépoussiérage ou une vérification du flux d’air sera vite rentable.`,
      href: `/miners/${unstableMiner.id}`,
      actionLabel: 'Planifier un contrôle',
    });
  }

  if (!items.length && total > 0) {
    items.push({
      id: 'steady-state',
      severity: 'info',
      title: 'La flotte est stable',
      detail: 'Aucune action urgente à signaler. Tous les mineurs fonctionnent dans les paramètres normaux.',
      href: '/miners',
      actionLabel: 'Voir les mineurs',
    });
  }

  return items.slice(0, 6);
}

export function getBestProfitMiner(fleet: AdvisorFleetMiner[]) {
  return [...fleet]
    .filter((miner) => miner.online && miner.profitability)
    .sort((left, right) => (right.profitability?.dailyNetEur || 0) - (left.profitability?.dailyNetEur || 0))[0] || null;
}

export function getWorstProfitMiner(fleet: AdvisorFleetMiner[]) {
  return [...fleet]
    .filter((miner) => miner.online && miner.profitability)
    .sort((left, right) => (left.profitability?.dailyNetEur || 0) - (right.profitability?.dailyNetEur || 0))[0] || null;
}

export function getThermalWatchlist(fleet: AdvisorFleetMiner[]) {
  return [...fleet]
    .filter((miner) => miner.online && (miner.latest?.tempAvg || 0) > 0)
    .sort((left, right) => (right.latest?.tempAvg || 0) - (left.latest?.tempAvg || 0))
    .slice(0, 5);
}

export function getEfficiencyWatchlist(fleet: AdvisorFleetMiner[]) {
  return [...fleet]
    .filter((miner) => miner.online && (miner.stats?.avgHashrate24h || 0) > 0)
    .map((miner) => ({
      miner,
      ratio: (miner.latest?.hashrateTHs || 0) / Math.max(1, miner.stats?.avgHashrate24h || 1),
    }))
    .sort((left, right) => left.ratio - right.ratio)
    .slice(0, 5);
}
