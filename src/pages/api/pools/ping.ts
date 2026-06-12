/**
 * POST /api/pools/ping
 * Mesure la latence TCP réelle vers chaque endpoint de pool (temps de
 * connexion socket). Body: { urls: string[] } → { results: { [url]: ms | null } }
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import net from 'net';
import { requireAuth } from '@/server/saas-auth';

const PING_TIMEOUT_MS = 5_000;
const MAX_URLS = 50;

/** Extrait host/port d'une URL stratum (ex: stratum+tcp://pool.example.com:3333). */
function parseEndpoint(url: string): { host: string; port: number } | null {
  const match = url.trim().match(/^(?:[a-z+]+:\/\/)?([^:/\s]+)(?::(\d+))?/i);
  if (!match || !match[1]) return null;
  const port = match[2] ? parseInt(match[2], 10) : 3333;
  if (!Number.isFinite(port) || port < 1 || port > 65535) return null;
  return { host: match[1], port };
}

/** Temps de connexion TCP en ms, ou null si injoignable sous 5s. */
function tcpConnectTime(host: string, port: number): Promise<number | null> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    const start = Date.now();
    let settled = false;

    const finish = (value: number | null) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(value);
    };

    socket.setTimeout(PING_TIMEOUT_MS);
    socket.once('connect', () => finish(Date.now() - start));
    socket.once('timeout', () => finish(null));
    socket.once('error', () => finish(null));
    socket.connect(port, host);
  });
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const auth = await requireAuth(req, res);
  if (!auth) return;

  const urls = Array.isArray(req.body?.urls)
    ? (req.body.urls as unknown[]).filter((u): u is string => typeof u === 'string').slice(0, MAX_URLS)
    : [];
  if (!urls.length) {
    return res.status(400).json({ error: 'urls[] requis' });
  }

  const results: Record<string, number | null> = {};
  await Promise.all(urls.map(async (url) => {
    const endpoint = parseEndpoint(url);
    results[url] = endpoint ? await tcpConnectTime(endpoint.host, endpoint.port) : null;
  }));

  return res.status(200).json({ results });
}
