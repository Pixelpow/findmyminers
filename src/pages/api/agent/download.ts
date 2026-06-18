import type { NextApiRequest, NextApiResponse } from 'next';
import fs from 'fs/promises';
import path from 'path';

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

async function resolveArtifact(platform: string) {
  const agentBase = path.join(process.cwd(), 'agent', 'windows-miner-agent');
  const candidates = PLATFORM_CANDIDATES[platform] || [];

  for (const relativeFile of candidates) {
    const absoluteFile = path.join(agentBase, relativeFile);
    try {
      const stat = await fs.stat(absoluteFile);
      if (stat.isFile()) {
        return {
          absoluteFile,
          filename: path.basename(absoluteFile),
          size: stat.size,
        };
      }
    } catch {
      // Try next candidate.
    }
  }

  return null;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const platform = typeof req.query.platform === 'string' ? req.query.platform : 'win-x64';
  const artifact = await resolveArtifact(platform);

  if (!artifact) {
    return res.status(404).json({
      error: 'Agent artifact not found on server',
      platform,
      hint: 'Build the agent artifact before downloading it.',
    });
  }

  const buffer = await fs.readFile(artifact.absoluteFile);
  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('Content-Disposition', `attachment; filename="${artifact.filename}"`);
  res.setHeader('Content-Length', String(buffer.length));
  return res.status(200).send(buffer);
}

export const config = {
  api: {
    responseLimit: '80mb',
  },
};