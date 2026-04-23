import { describe, it, expect } from 'bun:test';
import { signJwt, verifyJwt } from '../jwt.js';

describe('JWT', () => {
  const payload = { tenantId: 'tenant-1', userId: 'user-1', role: 'admin' as const, sfOrgId: 'org-1' };

  it('round-trips a payload', async () => {
    const token = await signJwt(payload, 'test-secret-min-32-chars-long!!!!!');
    expect(typeof token).toBe('string');
    const verified = await verifyJwt(token, 'test-secret-min-32-chars-long!!!!!');
    expect(verified?.tenantId).toBe('tenant-1');
    expect(verified?.userId).toBe('user-1');
    expect(verified?.role).toBe('admin');
  });

  it('returns null for a tampered token', async () => {
    const token = await signJwt(payload, 'test-secret-min-32-chars-long!!!!!');
    const tampered = token.slice(0, -5) + 'AAAAA';
    const result = await verifyJwt(tampered, 'test-secret-min-32-chars-long!!!!!');
    expect(result).toBeNull();
  });

  it('returns null for wrong secret', async () => {
    const token = await signJwt(payload, 'test-secret-min-32-chars-long!!!!!');
    const result = await verifyJwt(token, 'different-secret-min-32-chars-!!!');
    expect(result).toBeNull();
  });
});
