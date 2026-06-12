import type { NextApiRequest, NextApiResponse } from 'next';
import { requireAuth } from '@/server/saas-auth';
import { readDashboardConfig, updateDashboardConfig } from '@/server/miner-config';
import https from 'https';

function fetchJson(url: string, timeoutMs = 10000): Promise<any> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: timeoutMs }, (res) => {
      let data = '';
      res.on('data', (chunk: Buffer | string) => { data += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch { resolve(data.trim()); }
      });
    });
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.on('error', reject);
  });
}

/** Validate a Bitcoin address format (basic check). */
function isValidBtcAddress(addr: string): boolean {
  return /^(1|3|bc1)[a-zA-HJ-NP-Z0-9]{25,62}$/.test(addr);
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Demo mode: return mock wallet data
  if (process.env.DEMO_MODE === '1' && req.method === 'GET') {
    const { DEMO_WALLETS } = await import('@/server/demo-data');
    return res.status(200).json(DEMO_WALLETS);
  }

  const auth = await requireAuth(req, res);
  if (!auth) return;
  const orgId = auth.organization.id;

  if (req.method === 'GET') {
    // Return wallet addresses + balances
    const config = await readDashboardConfig(orgId);
    const addresses = config.walletAddresses || [];
    const wallets = await Promise.all(
      addresses.map(async (addr) => {
        try {
          // Use mempool.space API (public, no auth needed)
          const data = await fetchJson(`https://mempool.space/api/address/${encodeURIComponent(addr)}`);
          const funded = data?.chain_stats?.funded_txo_sum || 0;
          const spent = data?.chain_stats?.spent_txo_sum || 0;
          const balanceSats = funded - spent;
          return { address: addr, balanceSats, balanceBtc: balanceSats / 1e8, error: null };
        } catch {
          return { address: addr, balanceSats: 0, balanceBtc: 0, error: 'Failed to fetch' };
        }
      }),
    );
    return res.status(200).json({ wallets });
  }

  if (req.method === 'POST') {
    // Add a wallet address
    const { address } = req.body || {};
    if (!address || typeof address !== 'string') {
      return res.status(400).json({ error: 'Missing address' });
    }
    const trimmed = address.trim();
    if (!isValidBtcAddress(trimmed)) {
      return res.status(400).json({ error: 'Invalid Bitcoin address format' });
    }
    const config = await readDashboardConfig(orgId);
    const existing = config.walletAddresses || [];
    if (existing.includes(trimmed)) {
      return res.status(409).json({ error: 'Address already tracked' });
    }
    if (existing.length >= 10) {
      return res.status(400).json({ error: 'Maximum 10 wallet addresses' });
    }
    await updateDashboardConfig({ walletAddresses: [...existing, trimmed] }, orgId);
    return res.status(200).json({ ok: true });
  }

  if (req.method === 'DELETE') {
    // Remove a wallet address
    const { address } = req.body || {};
    if (!address || typeof address !== 'string') {
      return res.status(400).json({ error: 'Missing address' });
    }
    const config = await readDashboardConfig(orgId);
    const updated = (config.walletAddresses || []).filter((a) => a !== address.trim());
    await updateDashboardConfig({ walletAddresses: updated }, orgId);
    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
