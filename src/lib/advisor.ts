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

/** `t(fr, en)` — par défaut anglais (utilisé par Layout qui ne sert que le compteur). */
type Translate = (fr: string, en: string) => string;

export function buildFleetRecommendations(
  fleet: AdvisorFleetMiner[],
  total: number,
  t: Translate = (_fr, en) => en,
): AdvisorRecommendation[] {
  const items: AdvisorRecommendation[] = [];

  const hottestMiner = fleet
    .filter((miner) => miner.online && (miner.latest?.tempAvg || 0) > 0)
    .sort((left, right) => (right.latest?.tempAvg || 0) - (left.latest?.tempAvg || 0))[0];
  if (hottestMiner && (hottestMiner.latest?.tempAvg || 0) >= 90) {
    items.push({
      id: `thermal-${hottestMiner.id}`,
      severity: 'critical',
      title: `${t('Refroidir', 'Cool down')} ${hottestMiner.name}`,
      detail: t(
        `Température moyenne à ${(hottestMiner.latest?.tempAvg || 0).toFixed(0)}°C. Réduis le mode ou force les ventilateurs avant le throttling thermique.`,
        `Average temperature at ${(hottestMiner.latest?.tempAvg || 0).toFixed(0)}°C. Lower the mode or force the fans before thermal throttling.`,
      ),
      href: `/miners/${hottestMiner.id}`,
      actionLabel: t('Ouvrir le mineur', 'Open miner'),
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
        title: `${t('Inspecter', 'Inspect')} ${weakestMiner.name}`,
        detail: t(
          `Le hashrate actuel est à ${(baselineRatio * 100).toFixed(0)}% de sa baseline 24h. Vérifie le pool, la thermique et le tuning.`,
          `Current hashrate is at ${(baselineRatio * 100).toFixed(0)}% of its 24h baseline. Check the pool, thermals and tuning.`,
        ),
        href: `/miners/${weakestMiner.id}`,
        actionLabel: t('Inspecter', 'Inspect'),
      });
    }
  }

  const offlineMiner = fleet.find((miner) => !miner.online);
  if (offlineMiner) {
    items.push({
      id: `offline-${offlineMiner.id}`,
      severity: 'warning',
      title: `${offlineMiner.name} ${t('est hors ligne', 'is offline')}`,
      detail: t(
        'Vérifie la connectivité, l’alimentation ou la carte de contrôle avant que l’uptime ne se dégrade davantage.',
        'Check connectivity, power supply or the control board before uptime degrades further.',
      ),
      href: `/miners/${offlineMiner.id}`,
      actionLabel: t('Ouvrir le mineur', 'Open miner'),
    });
  }

  const unstableMiner = fleet
    .filter((miner) => miner.online)
    .sort((left, right) => (left.stats?.healthScore || 0) - (right.stats?.healthScore || 0))[0];
  if (unstableMiner && (unstableMiner.stats?.healthScore || 0) < 55) {
    items.push({
      id: `health-${unstableMiner.id}`,
      severity: 'info',
      title: `${t('Planifier la maintenance de', 'Schedule maintenance for')} ${unstableMiner.name}`,
      detail: t(
        `Score de santé à ${unstableMiner.stats?.healthScore || 0}/100. Un dépoussiérage ou une vérification du flux d’air sera vite rentable.`,
        `Health score at ${unstableMiner.stats?.healthScore || 0}/100. A dusting or airflow check will quickly pay off.`,
      ),
      href: `/miners/${unstableMiner.id}`,
      actionLabel: t('Planifier un contrôle', 'Schedule a check'),
    });
  }

  if (!items.length && total > 0) {
    items.push({
      id: 'steady-state',
      severity: 'info',
      title: t('La flotte est stable', 'The fleet is steady'),
      detail: t(
        'Aucune action urgente à signaler. Tous les mineurs fonctionnent dans les paramètres normaux.',
        'No urgent action to report. All miners are operating within normal parameters.',
      ),
      href: '/miners',
      actionLabel: t('Voir les mineurs', 'View miners'),
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
