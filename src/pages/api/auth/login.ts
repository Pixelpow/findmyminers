import type { NextApiRequest, NextApiResponse } from 'next';
import { loginAndCreateSession } from '@/server/saas-auth';
import { isRateLimited } from '@/server/rate-limit';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (isRateLimited(req, { maxAttempts: 5, windowMs: 60_000 })) {
    return res.status(429).json({ error: 'Too many login attempts. Please try again later.' });
  }

  try {
    const body = req.body || {};
    const payload = await loginAndCreateSession(
      {
        email: typeof body.email === 'string' ? body.email : '',
        password: typeof body.password === 'string' ? body.password : '',
      },
      res,
    );
    return res.status(200).json(payload);
  } catch (error: any) {
    return res.status(401).json({ error: error.message || 'Login failed' });
  }
}
