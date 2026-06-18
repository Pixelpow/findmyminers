import type { NextApiRequest, NextApiResponse } from 'next';
import { signupAndCreateSession } from '@/server/saas-auth';
import { isRateLimited } from '@/server/rate-limit';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (isRateLimited(req, { maxAttempts: 3, windowMs: 60_000 })) {
    return res.status(429).json({ error: 'Too many signup attempts. Please try again later.' });
  }

  try {
    const body = req.body || {};
    const payload = await signupAndCreateSession(
      {
        name: typeof body.name === 'string' ? body.name : '',
        email: typeof body.email === 'string' ? body.email : '',
        password: typeof body.password === 'string' ? body.password : '',
        organizationName: typeof body.organizationName === 'string' ? body.organizationName : undefined,
      },
      res,
    );
    return res.status(200).json(payload);
  } catch (error: any) {
    return res.status(400).json({ error: error.message || 'Signup failed' });
  }
}
