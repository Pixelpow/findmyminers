/**
 * POST /api/miner/add
 * Ajout MANUEL d'un mineur par son IP (et port optionnel).
 *
 * Contrairement au scan réseau (qui peut échouer en Docker bridge ou si le
 * sous-réseau est mal détecté), on sonde une adresse précise — ce qui marche
 * même quand le scan ne trouve rien. Si un mineur est détecté, on l'ajoute
 * avec son protocole/modèle ; sinon on renvoie une erreur claire.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { identifyMiner, getDriverForMiner } from '@/server/drivers';
import { readDashboardConfig, updateDashboardConfig, type MinerNode } from '@/server/miner-config';
import { requireAuth } from '@/server/saas-auth';

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const auth = await requireAuth(req, res);
  if (!auth) return;
  const orgId = auth.organization.id;

  try {
    const body = req.body || {};
    const ip = typeof body.ip === 'string' ? body.ip.trim() : '';
    const customName = typeof body.name === 'string' ? body.name.trim() : '';
    const portRaw = Number(body.port);
    const port = Number.isInteger(portRaw) && portRaw > 0 && portRaw < 65536 ? portRaw : undefined;

    // Validation : IPv4 valide, ou hostname simple.
    const isIpv4 = IPV4.test(ip) && ip.split('.').every((o: string) => Number(o) <= 255);
    const isHost = /^[a-zA-Z0-9][a-zA-Z0-9.\-]{0,253}$/.test(ip);
    if (!ip || (!isIpv4 && !isHost)) {
      return res.status(400).json({ error: 'Adresse IP ou nom d’hôte invalide.' });
    }

    const config = await readDashboardConfig(orgId);
    if (config.miners.some((m) => m.ip === ip && (port ? m.port === port : true))) {
      return res.status(409).json({ error: 'Ce mineur (cette IP) est déjà dans ta flotte.' });
    }

    // Sonde l'adresse : port fourni → ce port seul, sinon tous les ports drivers.
    const openPorts = port ? new Set([port]) : undefined;
    const identity = await identifyMiner(ip, 2500, openPorts);
    if (!identity) {
      return res.status(404).json({
        error: `Aucun mineur détecté à ${ip}${port ? ':' + port : ''}. Vérifie l’IP, le port (80 pour AxeOS, 4028 pour Avalon/CGMiner) et que le mineur est allumé sur le réseau.`,
      });
    }

    // Enrichit avec un poll live (modèle réel) — best-effort.
    const driver = getDriverForMiner({ protocol: identity.protocol });
    const live = await driver.poll(ip, identity.port, 3000).catch(() => null);
    const model = live?.model || identity.model;

    // ID unique : protocole + derniers chiffres de l'IP, suffixé si collision.
    const tail = isIpv4 ? ip.split('.').pop() : ip.replace(/[^a-z0-9]/gi, '').slice(-4);
    const existingIds = new Set(config.miners.map((m) => m.id));
    let id = `${identity.protocol}-${tail}`;
    let n = 2;
    while (existingIds.has(id)) id = `${identity.protocol}-${tail}-${n++}`;

    const miner: MinerNode = {
      id,
      name: customName || model || `Mineur ${ip}`,
      ip,
      port: identity.port,
      enabled: true,
      model,
      protocol: identity.protocol,
    };

    await updateDashboardConfig({ miners: [...config.miners, miner] }, orgId);

    return res.status(200).json({ ok: true, miner });
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : 'Ajout impossible' });
  }
}
