import { Hono } from 'hono';
import { serveStatic } from 'hono/bun';
import { loadConfig } from './config.ts';
import { getDb } from './db/client.ts';
import { filesRoutes } from './files/routes.ts';
import { recordsRoutes } from './records/routes.ts';
import { odataRoutes } from './odata/handler.ts';
import { statsRoutes } from './stats/routes.ts';
import { rulesRoutes } from './rules/routes.ts';
import { backupRoutes } from './backup/routes.ts';
import { authRoutes } from './auth/routes.ts';
import { teamRoutes } from './team/routes.ts';
import { settingsRoutes } from './settings/routes.ts';
import { setupAgentRoutes } from './agents/setup/routes.ts';
import { diffExplainerRoutes } from './agents/diff-explainer/routes.ts';
import { log } from './util/logger.ts';

const config = loadConfig();
getDb();
const app = new Hono();

app.get('/health', (c) => c.json({ ok: true, service: 'vastify-api', version: '0.1.0' }));

// CORS — allow cookies for JWT auth
app.use('/v1/*', async (c, next) => {
  const origin = c.req.header('Origin') ?? '*';
  c.header('Access-Control-Allow-Origin', origin);
  c.header('Access-Control-Allow-Credentials', 'true');
  c.header('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  c.header('Access-Control-Allow-Headers', 'Content-Type,X-Vastify-Api-Key,Authorization');
  if (c.req.method === 'OPTIONS') return c.body(null, 204);
  await next();
});

app.use('/auth/*', async (c, next) => {
  const origin = c.req.header('Origin') ?? '*';
  c.header('Access-Control-Allow-Origin', origin);
  c.header('Access-Control-Allow-Credentials', 'true');
  c.header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  c.header('Access-Control-Allow-Headers', 'Content-Type');
  if (c.req.method === 'OPTIONS') return c.body(null, 204);
  await next();
});

// Auth routes (handle their own auth internally)
app.route('', authRoutes);

// API routes
app.route('/v1/files', filesRoutes);
app.route('/v1/records', recordsRoutes);
app.route('/v1/stats', statsRoutes);
app.route('/v1/rules', rulesRoutes);
app.route('/v1/backup', backupRoutes);
app.route('/v1/team', teamRoutes);
app.route('/v1/settings', settingsRoutes);
app.route('/v1/agents/setup', setupAgentRoutes);
app.route('/v1/agents', diffExplainerRoutes);
app.route('/odata/v1', odataRoutes);

// Static files — React SPA build output
app.use('/*', serveStatic({ root: './public' }));
app.get('/*', serveStatic({ path: './public/index.html' }));

app.notFound((c) => c.json({ error: 'not_found', path: c.req.path }, 404));

app.onError((err, c) => {
  log.error('unhandled', { err: err.message, stack: err.stack });
  return c.json({ error: 'internal_error', message: err.message }, 500);
});

log.info('starting vastify-api', {
  port: config.port,
  env: config.env,
  backends: config.backends.filter((b) => b.enabled).map((b) => b.id),
});

export default {
  port: config.port,
  fetch: app.fetch,
};
