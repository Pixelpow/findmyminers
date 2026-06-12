/**
 * Server-side profitability calculator.
 * Fetches BTC price + difficulty from public APIs, caches results,
 * and computes net daily EUR based on hashrate, power, electricity cost, and pool fees.
 */

const BLOCK_REWARD_BTC = 3.125; // Post-halving 2024
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 min

type CryptoCache = {
  priceEur: number;
  priceUsd: number;
  difficulty: number;
  fetchedAt: number;
};

let cryptoCache: CryptoCache | null = null;

async function fetchWithTimeout(url: string, timeoutMs = 8000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export async function getCryptoData(): Promise<{ priceEur: number; priceUsd: number; difficulty: number }> {
  if (cryptoCache && Date.now() - cryptoCache.fetchedAt < CACHE_TTL_MS) {
    return { priceEur: cryptoCache.priceEur, priceUsd: cryptoCache.priceUsd, difficulty: cryptoCache.difficulty };
  }

  try {
    const [priceRes, diffRes] = await Promise.all([
      fetchWithTimeout('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd,eur'),
      fetchWithTimeout('https://blockchain.info/q/getdifficulty'),
    ]);

    if (!priceRes.ok || !diffRes.ok) {
      throw new Error('Crypto API returned non-OK status');
    }

    const priceData = await priceRes.json();
    const diffText = await diffRes.text();

    const priceEur = priceData?.bitcoin?.eur || 0;
    const priceUsd = priceData?.bitcoin?.usd || 0;
    const difficulty = parseFloat(diffText) || 1;

    cryptoCache = { priceEur, priceUsd, difficulty, fetchedAt: Date.now() };
    return { priceEur, priceUsd, difficulty };
  } catch (error) {
    // Return last cached data if available, otherwise defaults
    if (cryptoCache) {
      return { priceEur: cryptoCache.priceEur, priceUsd: cryptoCache.priceUsd, difficulty: cryptoCache.difficulty };
    }
    return { priceEur: 0, priceUsd: 0, difficulty: 1 };
  }
}

export type ProfitabilityInput = {
  hashrateTHs: number;
  powerW: number;
  elecCostEurKwh: number;
  poolFeePct: number;
};

export type ProfitabilityResult = {
  dailyBtc: number;
  dailyGrossEur: number;
  dailyElecCostEur: number;
  dailyNetEur: number;
  monthlyNetEur: number;
  btcPriceEur: number;
  btcPriceUsd: number;
  difficulty: number;
};

export async function computeProfitability(input: ProfitabilityInput): Promise<ProfitabilityResult> {
  const crypto = await getCryptoData();

  const hashRateH = input.hashrateTHs * 1e12; // H/s
  const dailyBtc = crypto.difficulty > 1
    ? (hashRateH * 86400 * BLOCK_REWARD_BTC) / (crypto.difficulty * 4294967296)
    : 0;

  const poolFeeFactor = Math.max(0, 1 - input.poolFeePct / 100);
  const dailyGrossEur = dailyBtc * crypto.priceEur * poolFeeFactor;
  const dailyElecCostEur = (input.powerW * 24 / 1000) * input.elecCostEurKwh;
  const dailyNetEur = dailyGrossEur - dailyElecCostEur;
  const monthlyNetEur = dailyNetEur * 30;

  return {
    dailyBtc,
    dailyGrossEur,
    dailyElecCostEur,
    dailyNetEur,
    monthlyNetEur,
    btcPriceEur: crypto.priceEur,
    btcPriceUsd: crypto.priceUsd,
    difficulty: crypto.difficulty,
  };
}
