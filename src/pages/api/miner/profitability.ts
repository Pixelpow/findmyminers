import type { NextApiRequest, NextApiResponse } from 'next';
import { requireAuth } from '@/server/saas-auth';
import { readDashboardConfig } from '@/server/miner-config';
import { readTelemetry, average, getPointsForRange } from '@/server/telemetry-store';
import { computeProfitability, getCryptoData } from '@/server/profitability';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const auth = await requireAuth(req, res);
  if (!auth) return;

  const orgId = auth.organization.id;

  try {
    const config = await readDashboardConfig(orgId);
    const crypto = await getCryptoData();
    const enabledMiners = config.miners.filter((m) => m.enabled);

    const miners = await Promise.all(
      enabledMiners.map(async (miner) => {
        const history = await readTelemetry(miner.id, orgId);
        const last24h = getPointsForRange(history, '24h');
        const avgHashrate = average(last24h.map((p) => p.hashrateTHs));
        const avgPower = average(last24h.map((p) => p.powerW));

        let profit = null;
        if (avgHashrate > 0) {
          profit = await computeProfitability({
            hashrateTHs: avgHashrate,
            powerW: avgPower || 0,
            elecCostEurKwh: config.profitability.elecCostEurKwh,
            poolFeePct: config.profitability.poolFeePct,
          });
        }

        return {
          id: miner.id,
          name: miner.name,
          model: miner.model,
          avgHashrateTHs: avgHashrate,
          avgPowerW: avgPower,
          profitability: profit,
        };
      }),
    );

    const totals = {
      dailyBtc: miners.reduce((s, m) => s + (m.profitability?.dailyBtc || 0), 0),
      dailyGrossEur: miners.reduce((s, m) => s + (m.profitability?.dailyGrossEur || 0), 0),
      dailyElecCostEur: miners.reduce((s, m) => s + (m.profitability?.dailyElecCostEur || 0), 0),
      dailyNetEur: miners.reduce((s, m) => s + (m.profitability?.dailyNetEur || 0), 0),
      monthlyNetEur: miners.reduce((s, m) => s + (m.profitability?.monthlyNetEur || 0), 0),
    };

    return res.status(200).json({
      miners,
      totals,
      crypto: {
        btcPriceEur: crypto.priceEur,
        btcPriceUsd: crypto.priceUsd,
        difficulty: crypto.difficulty,
      },
      config: {
        elecCostEurKwh: config.profitability.elecCostEurKwh,
        poolFeePct: config.profitability.poolFeePct,
        showProfitability: config.ui.showProfitability ?? false,
      },
    });
  } catch (error: any) {
    return res.status(500).json({ error: error.message || 'Failed to compute profitability' });
  }
}
