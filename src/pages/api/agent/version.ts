/**
 * GET /api/agent/version
 * Returns the latest agent version and download URLs.
 * Used by agents for auto-update checks.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import fs from 'fs/promises';
import path from 'path';

let cachedVersion: string | null = null;

const PLATFORM_CANDIDATES: Record<string, string[]> = {
  'win-x64': [
    path.join('dist', 'findmyminers-agent.exe'),
    path.join('release', 'findmyminers-agent.exe'),
  ],
  'linux-x64': [
    path.join('dist', 'findmyminers-agent-linux-x64'),
    path.join('release', 'findmyminers-agent-linux-x64'),
  ],
  'linux-arm64': [
    path.join('dist', 'findmyminers-agent-linux-arm64'),
    path.join('release', 'findmyminers-agent-linux-arm64'),
  ],
};

async function getAgentVersion(): Promise<string> {
  if (cachedVersion) return cachedVersion;
  try {
    const pkgPath = path.join(process.cwd(), 'agent', 'windows-miner-agent', 'package.json');
    const raw = await fs.readFile(pkgPath, 'utf-8');
    const pkg = JSON.parse(raw);
    cachedVersion = pkg.version || '0.1.0';
    return cachedVersion!;
  } catch {
    return '0.1.0';
  }
}

async function buildPlatformMap(req: NextApiRequest) {
  const agentBase = path.join(process.cwd(), 'agent', 'windows-miner-agent');
  const host = typeof req.headers.host === 'string' ? req.headers.host : 'localhost:3000';
  const protocol = (req.headers['x-forwarded-proto'] as string) || (host.includes('localhost') ? 'http' : 'https');
  const baseUrl = `${protocol}://${host}`;

  const platforms = await Promise.all(
    Object.entries(PLATFORM_CANDIDATES).map(async ([platform, candidates]) => {
      let filename = path.basename(candidates[0]);
      let available = false;
      let size: number | null = null;

      for (const relativeFile of candidates) {
        const absoluteFile = path.join(agentBase, relativeFile);
        try {
          const stat = await fs.stat(absoluteFile);
          if (stat.isFile()) {
            filename = path.basename(absoluteFile);
            available = true;
            size = stat.size;
            break;
          }
        } catch {
          // Keep looking.
        }
      }

      return [platform, {
        filename,
        available,
        size,
        downloadUrl: `${baseUrl}/api/agent/download?platform=${encodeURIComponent(platform)}`,
      }];
    }),
  );

  return Object.fromEntries(platforms);
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const version = await getAgentVersion();
  const platforms = await buildPlatformMap(req);

  return res.status(200).json({
    version,
    platforms,
  });
}
