const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const dataDir = path.join(process.cwd(), 'data');
const authFile = path.join(dataDir, 'saas-auth.json');

fs.mkdirSync(dataDir, { recursive: true });

const now = Date.now();
const makeId = (prefix) => `${prefix}_${crypto.randomBytes(8).toString('hex')}`;
const hashPassword = (password, salt) => crypto.pbkdf2Sync(password, salt, 120000, 32, 'sha256').toString('hex');

let store = { users: [], organizations: [], memberships: [], sessions: [] };
if (fs.existsSync(authFile)) {
  try {
    const parsed = JSON.parse(fs.readFileSync(authFile, 'utf8'));
    store = {
      users: Array.isArray(parsed.users) ? parsed.users : [],
      organizations: Array.isArray(parsed.organizations) ? parsed.organizations : [],
      memberships: Array.isArray(parsed.memberships) ? parsed.memberships : [],
      sessions: Array.isArray(parsed.sessions) ? parsed.sessions : [],
    };
  } catch {}
}

const email = 'admin@test.findmyminers.local';
const password = 'Admin1234!';
const orgName = 'FindMyMiners Test Org';
const slug = 'findmyminers-test-org';

let user = store.users.find((u) => u.email === email);
if (!user) {
  const salt = crypto.randomBytes(16).toString('hex');
  user = {
    id: makeId('usr'),
    name: 'Admin Test',
    email,
    passwordSalt: salt,
    passwordHash: hashPassword(password, salt),
    createdAt: now,
  };
  store.users.push(user);
} else {
  const salt = crypto.randomBytes(16).toString('hex');
  user.passwordSalt = salt;
  user.passwordHash = hashPassword(password, salt);
  if (!user.name) user.name = 'Admin Test';
}

let org = store.organizations.find((o) => o.slug === slug) || store.organizations.find((o) => o.name === orgName);
if (!org) {
  org = {
    id: makeId('org'),
    name: orgName,
    slug,
    createdAt: now,
  };
  store.organizations.push(org);
}

const membershipIndex = store.memberships.findIndex((m) => m.userId === user.id && m.orgId === org.id);
if (membershipIndex >= 0) {
  store.memberships[membershipIndex] = { ...store.memberships[membershipIndex], role: 'admin' };
} else {
  store.memberships.push({ userId: user.id, orgId: org.id, role: 'admin', createdAt: now });
}

fs.writeFileSync(authFile, JSON.stringify(store, null, 2), 'utf8');
console.log('Admin account ready');
console.log(`EMAIL=${email}`);
console.log(`PASSWORD=${password}`);
console.log(`FILE=${authFile}`);
