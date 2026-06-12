import type { NextApiRequest, NextApiResponse } from 'next';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  res.redirect(307, '/api/agent/download?platform=win-x64');
}

export const config = {
  api: {
    responseLimit: '80mb',
  },
};

