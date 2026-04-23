import { Hono } from 'hono';
import { setCookie, deleteCookie } from 'hono/cookie';
import { randomUUID } from 'node:crypto';
import { loadConfig } from '../config.ts';
import { getDb } from '../db/client.ts';
import { requireApiKey, tenantOf, userOf, roleOf } from './api-key.ts';
import { signJwt } from './jwt.ts';
import { createAuthRepo } from './repo.ts';

const SF_AUTH_URL = 'https://login.salesforce.com/services/oauth2/authorize';
const SF_TOKEN_URL = 'https://login.salesforce.com/services/oauth2/token';

export const authRoutes = new Hono();

function getRepo() {
  return createAuthRepo(getDb());
}

// Redirect user to Salesforce OAuth
authRoutes.get('/auth/salesforce/login', (c) => {
  const config = loadConfig();
  const intent = c.req.query('intent');
  const state = intent === 'connect-org' ? 'connect-org' : 'login';
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: config.sfClientId,
    redirect_uri: config.sfRedirectUri,
    scope: 'openid profile email api refresh_token',
    state,
  });
  return c.redirect(`${SF_AUTH_URL}?${params.toString()}`);
});

// Handle OAuth callback from Salesforce
authRoutes.get('/auth/salesforce/callback', async (c) => {
  const config = loadConfig();
  const repo = getRepo();
  const code = c.req.query('code');
  const state = c.req.query('state') ?? 'login';

  if (!code) return c.json({ error: 'missing_code' }, 400);

  // Exchange code for tokens
  const tokenRes = await fetch(SF_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      client_id: config.sfClientId,
      client_secret: config.sfClientSecret,
      redirect_uri: config.sfRedirectUri,
    }),
  });
  if (!tokenRes.ok) return c.json({ error: 'token_exchange_failed' }, 502);
  const tokens = await tokenRes.json() as { access_token: string; instance_url: string };

  // Get user info
  const userInfoRes = await fetch(`${tokens.instance_url}/services/oauth2/userinfo`, {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });
  if (!userInfoRes.ok) return c.json({ error: 'userinfo_failed' }, 502);
  const sfUser = await userInfoRes.json() as {
    sub: string; organization_id: string; preferred_username: string; name: string; email?: string;
  };

  // SF sub is a URL like https://...salesforce.com/id/orgId/userId — extract the last segment
  const sfUserId = sfUser.sub.split('/').pop() ?? sfUser.sub;
  const sfOrgId = sfUser.organization_id;

  // Handle connect-org intent: redirect back to dashboard without provisioning
  if (state === 'connect-org') {
    return c.redirect('/backups?connected=1');
  }

  // Provision tenant if first login from this org
  let tenant = repo.tenants.findBySfOrgId(sfOrgId);
  if (!tenant) {
    tenant = repo.tenants.create(sfOrgId, sfUser.name ?? sfUser.preferred_username);
    repo.storageConfig.initForTenant(tenant.id);
  }

  const now = Date.now();
  const user = repo.users.upsert({
    sfUserId, sfOrgId, sfUsername: sfUser.preferred_username,
    displayName: sfUser.name ?? sfUser.preferred_username,
    email: sfUser.email ?? null, createdAt: now, lastLoginAt: now,
  });

  // Provision membership (first user is admin)
  const existingMember = repo.members.findByTenantAndUser(tenant.id, user.id);
  if (!existingMember) {
    const isFirstMember = repo.members.countByTenant(tenant.id) === 0;
    repo.members.insert({
      id: randomUUID(), tenantId: tenant.id, userId: user.id,
      role: isFirstMember ? 'admin' : 'member', joinedAt: now,
    });
  }

  const member = repo.members.findByTenantAndUser(tenant.id, user.id)!;
  const token = await signJwt(
    { tenantId: tenant.id, userId: user.id, role: member.role, sfOrgId },
    config.jwtSecret,
  );

  setCookie(c, 'vastify_session', token, {
    httpOnly: true,
    sameSite: 'Lax',
    secure: config.env === 'production',
    maxAge: 8 * 60 * 60,
    path: '/',
  });

  return c.redirect('/');
});

// Clear session cookie
authRoutes.post('/auth/logout', (c) => {
  deleteCookie(c, 'vastify_session', { path: '/' });
  return c.json({ ok: true });
});

// Return current user info
authRoutes.get('/auth/me', requireApiKey, (c) => {
  const repo = getRepo();
  const tenantId = tenantOf(c);
  const userId = userOf(c);
  const role = roleOf(c);
  const members = repo.members.findByTenant(tenantId);
  const user = userId ? repo.users.findById(userId) : null;
  return c.json({
    tenantId, userId, role, memberCount: members.length,
    displayName: user?.displayName ?? null,
    email: user?.email ?? null,
    sfUsername: user?.sfUsername ?? null,
  });
});
