import { Hono } from 'hono';
import { loadConfig } from './config.ts';
import { getDb } from './db/client.ts';
import { filesRoutes } from './files/routes.ts';
import { recordsRoutes } from './records/routes.ts';
import { odataRoutes } from './odata/handler.ts';
import { statsRoutes } from './stats/routes.ts';
import { rulesRoutes } from './rules/routes.ts';
import { log } from './util/logger.ts';

const config = loadConfig();
getDb();
const app = new Hono();

app.get('/health', (c) => c.json({ ok: true, service: 'vastify-api', version: '0.1.0' }));

// CORS for the dashboard dev server
app.use('/v1/*', async (c, next) => {
  c.header('Access-Control-Allow-Origin', '*');
  c.header('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  c.header('Access-Control-Allow-Headers', 'Content-Type,X-Vastify-Api-Key');
  if (c.req.method === 'OPTIONS') return c.body(null, 204);
  await next();
});

app.route('/v1/files', filesRoutes);
app.route('/v1/records', recordsRoutes);
app.route('/v1/stats', statsRoutes);
app.route('/v1/rules', rulesRoutes);
app.route('/odata/v1', odataRoutes);

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
