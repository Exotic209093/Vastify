import { Hono, type Context, type Next } from 'hono';
import { serveStatic } from 'hono/bun';
import { loadConfig } from './config.ts';
import { getDb } from './db/client.ts';
import { ensureBucketsExist } from './object/registry.ts';
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

// Refuse to boot in production with the insecure default secrets.
// VAULT_MASTER_KEY encrypts OAuth refresh tokens at rest; JWT_SECRET signs sessions.
// Either fallback being used in prod = a known-key compromise on day one.
if (config.env === 'production') {
  if (config.vaultMasterKeyHex === '0'.repeat(64)) {
    throw new Error(
      'VAULT_MASTER_KEY must be set in production. Generate one with: openssl rand -hex 32',
    );
  }
  if (config.jwtSecret === 'dev-secret-change-me-in-production-min-32-chars') {
    throw new Error(
      'JWT_SECRET must be set in production. Generate one with: openssl rand -base64 48',
    );
  }
}

getDb();
// Fire-and-forget — survive transient backend hiccups during boot.
ensureBucketsExist().catch((e) => log.error('ensureBucketsExist failed', { err: (e as Error).message }));
const app = new Hono();

app.get('/health', (c) => c.json({ ok: true, service: 'vastify-api', version: '0.1.0' }));

// CORS — explicit origin allowlist + credentials, never wildcard reflection.
// Set ALLOWED_ORIGINS env var (comma-separated) to add extra origins.
const allowedOriginSet = new Set(config.allowedOrigins);
function corsFor(allowedMethods: string, allowedHeaders: string) {
  return async (c: Context, next: Next) => {
    const origin = c.req.header('Origin');
    if (origin && allowedOriginSet.has(origin)) {
      c.header('Access-Control-Allow-Origin', origin);
      c.header('Access-Control-Allow-Credentials', 'true');
      c.header('Vary', 'Origin');
    }
    c.header('Access-Control-Allow-Methods', allowedMethods);
    c.header('Access-Control-Allow-Headers', allowedHeaders);
    if (c.req.method === 'OPTIONS') return c.body(null, 204);
    await next();
  };
}

app.use('/v1/*', corsFor('GET,POST,PUT,PATCH,DELETE,OPTIONS', 'Content-Type,X-Vastify-Api-Key,Authorization'));
app.use('/auth/*', corsFor('GET,POST,OPTIONS', 'Content-Type'));

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
  // Bun closes idle connections after 10s by default. SSE streams (Setup Agent
  // tool calls take 21s on deploy_sf_package; Diff Explainer Claude calls can
  // take 30s+) need much longer. Cap at 255s (Bun's max).
  idleTimeout: 255,
  fetch: app.fetch,
};
