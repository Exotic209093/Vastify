import { loadConfig } from '../config.ts';
import type { BackendId, ObjectBackend } from './backend.ts';
import { createMinioBackend } from './minio.ts';
import { createS3Backend } from './s3.ts';
import { createGcsBackend } from './gcs.ts';
import { createAzureBackend } from './azure.ts';
import { log } from '../util/logger.ts';

let registry: Map<BackendId, ObjectBackend> | null = null;

export function getBackends(): Map<BackendId, ObjectBackend> {
  if (registry) return registry;
  const cfg = loadConfig();
  registry = new Map();
  for (const b of cfg.backends) {
    if (!b.enabled) continue;
    try {
      switch (b.id) {
        case 'minio':
          registry.set('minio', createMinioBackend(b));
          break;
        case 's3':
          registry.set('s3', createS3Backend(b));
          break;
        case 'gcs':
          registry.set('gcs', createGcsBackend(b));
          break;
        case 'azure':
          registry.set('azure', createAzureBackend(b));
          break;
      }
    } catch (e) {
      log.error(`failed to init backend ${b.id}`, { err: (e as Error).message });
    }
  }
  log.info('backends ready', { ids: Array.from(registry.keys()) });
  return registry;
}

export function getBackend(id: BackendId): ObjectBackend {
  const b = getBackends().get(id);
  if (!b) throw new Error(`backend '${id}' not configured or not enabled`);
  return b;
}

/** Test-only: override the registry. */
export function setTestBackends(map: Map<BackendId, ObjectBackend>): void {
  registry = map;
}
