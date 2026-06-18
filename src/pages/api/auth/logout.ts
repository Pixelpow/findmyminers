import type { NextApiRequest, NextApiResponse } from 'next';
import { logoutSession } from '@/server/saas-auth';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  await logoutSession(req, res);
  return res.status(200).json({ success: true });
}
