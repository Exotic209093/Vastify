import { Hono } from 'hono';
import { randomUUID } from 'node:crypto';
import { requireApiKey, requireAdmin, tenantOf, userOf } from '../auth/api-key.ts';
import { getDb } from '../db/client.ts';
import { createAuthRepo } from '../auth/repo.ts';

export const teamRoutes = new Hono();

function getRepo() {
  return createAuthRepo(getDb());
}

// Public: validate an invite token (must be before requireApiKey)
teamRoutes.get('/invite/:token', (c) => {
  const invite = getRepo().invites.findByToken(c.req.param('token') ?? '');
  if (!invite || invite.acceptedAt !== null || invite.expiresAt < Date.now()) {
    return c.json({ error: 'invite not found or expired' }, 404);
  }
  return c.json({ tenantId: invite.tenantId, email: invite.email, role: invite.role });
});

teamRoutes.use('*', requireApiKey);

// List members and pending invites
teamRoutes.get('/', (c) => {
  const tenantId = tenantOf(c);
  const repo = getRepo();
  const members = repo.members.findByTenant(tenantId);
  const invites = repo.invites.findByTenant(tenantId).filter((i) => i.acceptedAt === null && i.expiresAt > Date.now());
  return c.json({ members, invites });
});

// Invite a new member by email
teamRoutes.post('/invite', requireAdmin, async (c) => {
  const tenantId = tenantOf(c);
  const userId = userOf(c);
  if (!userId) return c.json({ error: 'invite requires user session' }, 400);

  const body = await c.req.json<{ email?: string; role?: string }>();
  if (!body.email) return c.json({ error: 'email required' }, 400);
  const role = body.role === 'admin' ? 'admin' : 'member';

  const token = randomUUID();
  const now = Date.now();

  getRepo().invites.insert({
    id: randomUUID(), tenantId, invitedByUserId: userId, email: body.email,
    role, token, createdAt: now, expiresAt: now + 7 * 24 * 60 * 60 * 1000, acceptedAt: null,
  });

  const host = c.req.header('Origin') ?? `${c.req.header('X-Forwarded-Proto') ?? 'http'}://${c.req.header('Host') ?? 'localhost'}`;
  const inviteUrl = `${host}/team/invite/${token}`;

  return c.json({ token, inviteUrl }, 201);
});

// Remove a member (admin only, cannot remove self)
teamRoutes.delete('/:userId', requireAdmin, (c) => {
  const tenantId = tenantOf(c);
  const callerUserId = userOf(c);
  const targetUserId = c.req.param('userId');

  if (!targetUserId) return c.json({ error: 'userId required' }, 400);
  if (targetUserId === callerUserId) return c.json({ error: 'cannot remove yourself' }, 400);
  getRepo().members.remove(tenantId, targetUserId);
  return new Response(null, { status: 204 });
});
