import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import type { NextApiRequest, NextApiResponse } from 'next';

export type SaasUser = {
  id: string;
  name: string;
  email: string;
  passwordHash: string;
  passwordSalt: string;
  createdAt: number;
};

export type SaasOrganization = {
  id: string;
  name: string;
  slug: string;
  createdAt: number;
};

export type SaasMembership = {
  userId: string;
  orgId: string;
  role: 'owner' | 'admin' | 'member';
  createdAt: number;
};

export type SaasSession = {
  token: string;
  userId: string;
  orgId: string;
  createdAt: number;
  expiresAt: number;
};

type SaasStore = {
  users: SaasUser[];
  organizations: SaasOrganization[];
  memberships: SaasMembership[];
  sessions: SaasSession[];
};

const DATA_DIR = path.join(process.cwd(), 'data');
const AUTH_FILE = path.join(DATA_DIR, 'saas-auth.json');
const SESSION_COOKIE = 'findmyminers_session';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const defaultStore: SaasStore = {
  users: [],
  organizations: [],
  memberships: [],
  sessions: [],
};

function makeId(prefix: string) {
  return `${prefix}_${crypto.randomBytes(8).toString('hex')}`;
}

function hashPassword(password: string, salt: string) {
  return crypto.pbkdf2Sync(password, salt, 120_000, 32, 'sha256').toString('hex');
}

function parseCookies(req: NextApiRequest): Record<string, string> {
  const header = req.headers.cookie;
  if (!header) return {};
  return header.split(';').reduce<Record<string, string>>((acc, pair) => {
    const [k, ...rest] = pair.trim().split('=');
    acc[k] = decodeURIComponent(rest.join('='));
    return acc;
  }, {});
}

async function ensureStore() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  try {
    await fs.access(AUTH_FILE);
  } catch {
    await fs.writeFile(AUTH_FILE, JSON.stringify(defaultStore, null, 2), 'utf-8');
  }
}

async function readStore(): Promise<SaasStore> {
  await ensureStore();
  const raw = await fs.readFile(AUTH_FILE, 'utf-8');
  try {
    const parsed = JSON.parse(raw) as SaasStore;
    return {
      users: Array.isArray(parsed.users) ? parsed.users : [],
      organizations: Array.isArray(parsed.organizations) ? parsed.organizations : [],
      memberships: Array.isArray(parsed.memberships) ? parsed.memberships : [],
      sessions: Array.isArray(parsed.sessions) ? parsed.sessions : [],
    };
  } catch {
    return { ...defaultStore };
  }
}

async function writeStore(store: SaasStore) {
  await ensureStore();
  await fs.writeFile(AUTH_FILE, JSON.stringify(store, null, 2), 'utf-8');
}

function sanitizeUser(user: SaasUser) {
  return { id: user.id, name: user.name, email: user.email, createdAt: user.createdAt };
}

function setSessionCookie(res: NextApiResponse, token: string) {
  const parts = [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`,
  ];
  if (process.env.NODE_ENV === 'production') parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

export function clearSessionCookie(res: NextApiResponse) {
  const parts = [
    `${SESSION_COOKIE}=`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=0',
  ];
  if (process.env.NODE_ENV === 'production') parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

function slugify(name: string) {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)+/g, '')
    .slice(0, 40) || 'org';
}

async function createSession(store: SaasStore, userId: string, orgId: string) {
  const token = makeId('sess');
  const now = Date.now();
  const session: SaasSession = {
    token,
    userId,
    orgId,
    createdAt: now,
    expiresAt: now + SESSION_TTL_MS,
  };
  store.sessions = [...store.sessions.filter((s) => s.expiresAt > now), session];
  await writeStore(store);
  return session;
}

export async function signupAndCreateSession(
  input: { name: string; email: string; password: string; organizationName?: string },
  res: NextApiResponse,
) {
  const store = await readStore();
  const email = input.email.trim().toLowerCase();
  if (!email || !input.password.trim()) throw new Error('Email et mot de passe requis');

  if (store.users.some((u) => u.email === email)) {
    throw new Error('Cet email est déjà utilisé');
  }

  const now = Date.now();
  const salt = crypto.randomBytes(16).toString('hex');
  const user: SaasUser = {
    id: makeId('usr'),
    name: input.name.trim() || email.split('@')[0] || 'Operator',
    email,
    passwordSalt: salt,
    passwordHash: hashPassword(input.password, salt),
    createdAt: now,
  };

  const baseOrgName = input.organizationName?.trim() || `${user.name}'s Org`;
  let slug = slugify(baseOrgName);
  let suffix = 1;
  while (store.organizations.some((o) => o.slug === slug)) {
    slug = `${slugify(baseOrgName)}-${suffix++}`;
  }

  const org: SaasOrganization = {
    id: makeId('org'),
    name: baseOrgName,
    slug,
    createdAt: now,
  };

  const membership: SaasMembership = {
    userId: user.id,
    orgId: org.id,
    role: 'owner',
    createdAt: now,
  };

  store.users.push(user);
  store.organizations.push(org);
  store.memberships.push(membership);

  const session = await createSession(store, user.id, org.id);
  setSessionCookie(res, session.token);

  return {
    user: sanitizeUser(user),
    organization: org,
    organizations: [org],
  };
}

export async function loginAndCreateSession(input: { email: string; password: string }, res: NextApiResponse) {
  const store = await readStore();
  const email = input.email.trim().toLowerCase();
  const user = store.users.find((u) => u.email === email);
  if (!user) throw new Error('Compte introuvable');

  const expected = hashPassword(input.password, user.passwordSalt);
  if (expected !== user.passwordHash) throw new Error('Identifiants invalides');

  const memberships = store.memberships.filter((m) => m.userId === user.id);
  const firstOrgId = memberships[0]?.orgId;
  if (!firstOrgId) throw new Error('Aucune organisation associée à ce compte');

  const session = await createSession(store, user.id, firstOrgId);
  setSessionCookie(res, session.token);

  const organizations = store.organizations.filter((org) => memberships.some((m) => m.orgId === org.id));
  const currentOrg = organizations.find((o) => o.id === firstOrgId) || organizations[0];

  return {
    user: sanitizeUser(user),
    organization: currentOrg,
    organizations,
  };
}

export async function logoutSession(req: NextApiRequest, res: NextApiResponse) {
  const cookies = parseCookies(req);
  const token = cookies[SESSION_COOKIE];
  if (token) {
    const store = await readStore();
    store.sessions = store.sessions.filter((s) => s.token !== token);
    await writeStore(store);
  }
  clearSessionCookie(res);
}

export async function getAuthContext(req: NextApiRequest) {
  // Demo mode: return a fake authenticated user so all API routes work
  if (process.env.DEMO_MODE === '1') {
    return {
      token: 'demo_token',
      user: { id: 'usr_demo', name: 'E. Blackwood', email: 'demo@findmyminers.local', createdAt: Date.now() - 86400000 * 30 },
      organization: { id: 'org_demo', name: 'NovaMining', slug: 'nova-mining', createdAt: Date.now() - 86400000 * 90 },
      organizations: [{ id: 'org_demo', name: 'NovaMining', slug: 'nova-mining', createdAt: Date.now() - 86400000 * 90 }],
      role: 'owner' as const,
    };
  }

  const cookies = parseCookies(req);
  const token = cookies[SESSION_COOKIE];
  const store = await readStore();
  const now = Date.now();
  const session = token ? store.sessions.find((s) => s.token === token && s.expiresAt > now) : null;

  if (session) {
    const user = store.users.find((u) => u.id === session.userId);
    if (user) {
      const memberships = store.memberships.filter((m) => m.userId === user.id);
      const organizations = store.organizations.filter((org) => memberships.some((m) => m.orgId === org.id));
      const currentOrg = organizations.find((o) => o.id === session.orgId) || organizations[0];
      if (currentOrg) {
        return {
          token,
          user: sanitizeUser(user),
          organization: currentOrg,
          organizations,
          role: memberships.find((m) => m.orgId === currentOrg.id)?.role || 'member',
        };
      }
    }
  }

  // Self-hosted local mode: no login required for your own LAN dashboard.
  // Unlike DEMO_MODE this serves REAL data — it just auto-selects an org.
  // Opt-in via LOCAL_MODE=1 so multi-tenant/SaaS deployments are unaffected.
  if (process.env.LOCAL_MODE === '1') {
    const lastSession = [...store.sessions].sort((a, b) => b.createdAt - a.createdAt)[0];
    const orgId = process.env.LOCAL_ORG_ID || lastSession?.orgId || store.organizations[0]?.id || 'public';
    const user = (lastSession && store.users.find((u) => u.id === lastSession.userId))
      || store.users[0]
      || { id: 'usr_local', name: 'Local', email: 'local@findmyminers.local', passwordHash: '', passwordSalt: '', createdAt: Date.now() };
    const organization = store.organizations.find((o) => o.id === orgId)
      || { id: orgId, name: 'Local', slug: 'local', createdAt: Date.now() };
    const memberships = store.memberships.filter((m) => m.userId === user.id);
    const organizations = store.organizations.filter((org) => memberships.some((m) => m.orgId === org.id));
    return {
      token: 'local',
      user: sanitizeUser(user),
      organization,
      organizations: organizations.length ? organizations : [organization],
      role: 'owner' as const,
    };
  }

  return null;
}

export async function switchSessionOrganization(req: NextApiRequest, res: NextApiResponse, orgId: string) {
  const cookies = parseCookies(req);
  const token = cookies[SESSION_COOKIE];
  if (!token) throw new Error('Not authenticated');

  const store = await readStore();
  const session = store.sessions.find((s) => s.token === token && s.expiresAt > Date.now());
  if (!session) throw new Error('Session invalide');

  const allowed = store.memberships.some((m) => m.userId === session.userId && m.orgId === orgId);
  if (!allowed) throw new Error('Organisation non autorisée');

  session.orgId = orgId;
  await writeStore(store);

  const user = store.users.find((u) => u.id === session.userId)!;
  const memberships = store.memberships.filter((m) => m.userId === user.id);
  const organizations = store.organizations.filter((org) => memberships.some((m) => m.orgId === org.id));
  const organization = organizations.find((org) => org.id === orgId)!;

  return {
    user: sanitizeUser(user),
    organization,
    organizations,
  };
}

export async function requireAuth(req: NextApiRequest, res: NextApiResponse) {
  const context = await getAuthContext(req);
  if (!context) {
    res.status(401).json({ error: 'Authentication required' });
    return null;
  }
  return context;
}
