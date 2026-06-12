import type { NextApiRequest, NextApiResponse } from 'next';
import { requireAuth } from '@/server/saas-auth';
import { registerPushSubscription, unregisterPushSubscription } from '@/server/push-notifications';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const auth = await requireAuth(req, res);
  if (!auth) return;

  try {
    if (req.method === 'POST') {
      registerPushSubscription(auth.organization.id, req.body?.subscription);
      return res.status(200).json({ ok: true });
    }

    if (req.method === 'DELETE') {
      unregisterPushSubscription(auth.organization.id, String(req.body?.endpoint || ''));
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Push subscription update failed';
    return res.status(500).json({ error: message });
  }
}