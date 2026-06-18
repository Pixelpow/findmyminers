import type { NextApiRequest, NextApiResponse } from 'next';
import { getAuthContext } from '@/server/saas-auth';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const auth = await getAuthContext(req);
  if (!auth) return res.status(401).json({ error: 'Not authenticated' });
  return res.status(200).json(auth);
}
