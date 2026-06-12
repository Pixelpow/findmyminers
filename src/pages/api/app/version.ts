import type { NextApiRequest, NextApiResponse } from 'next';
import fs from 'fs/promises';
import path from 'path';

let cachedVersion: string | null = null;

async function getAppVersion() {
  if (cachedVersion) return cachedVersion;
  try {
    const pkgPath = path.join(process.cwd(), 'package.json');
    const raw = await fs.readFile(pkgPath, 'utf-8');
    const pkg = JSON.parse(raw);
    cachedVersion = pkg.version || '0.1.0';
    return cachedVersion;
  } catch {
    return '0.1.0';
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const version = await getAppVersion();
  return res.status(200).json({
    name: 'findmyminers',
    version,
    deployment: 'web-app',
    ts: Date.now(),
  });
}