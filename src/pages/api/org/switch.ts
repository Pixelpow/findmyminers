import type { NextApiRequest, NextApiResponse } from 'next';
import { switchSessionOrganization } from '@/server/saas-auth';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const orgId = typeof req.body?.orgId === 'string' ? req.body.orgId : '';
    if (!orgId) return res.status(400).json({ error: 'orgId is required' });

    const payload = await switchSessionOrganization(req, res, orgId);
    return res.status(200).json(payload);
  } catch (error: any) {
    return res.status(400).json({ error: error.message || 'Unable to switch organization' });
  }
}
