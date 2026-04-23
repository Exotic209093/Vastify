import { describe, it, expect, vi, afterEach } from 'vitest';
import { HubSpotAdapter } from '../src/crm/hubspot-adapter.js';
import { HubSpotWriteNotSupportedError } from '../src/errors.js';

const getToken = vi.fn().mockResolvedValue('hs-token');

function mockFetch(body: unknown, status = 200) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  });
}

afterEach(() => vi.unstubAllGlobals());

describe('HubSpotAdapter — listObjects', () => {
  it('includes standard objects plus custom schemas', async () => {
    vi.stubGlobal('fetch', mockFetch({
      results: [
        { objectTypeId: '2-custom', name: 'custom_obj', labels: { singular: 'Widget', plural: 'Widgets' } },
      ],
    }));
    const adapter = new HubSpotAdapter(getToken);
    const objects = await adapter.listObjects();
    const names = objects.map((o) => o.name);
    expect(names).toContain('contacts');
    expect(names).toContain('companies');
    expect(names).toContain('2-custom');
  });
});

describe('HubSpotAdapter — describe (standard object)', () => {
  it('returns fields from properties endpoint', async () => {
    vi.stubGlobal('fetch', mockFetch({
      results: [
        { name: 'email', label: 'Email', type: 'string' },
        { name: 'firstname', label: 'First Name', type: 'string' },
      ],
    }));
    const adapter = new HubSpotAdapter(getToken);
    const schema = await adapter.describe('contacts');
    expect(schema.name).toBe('contacts');
    expect(schema.fields).toHaveLength(2);
    expect(schema.fields[0]).toMatchObject({ name: 'email', type: 'string' });
  });
});

describe('HubSpotAdapter — describe (custom object)', () => {
  it('returns fields from schemas endpoint for custom objects', async () => {
    vi.stubGlobal('fetch', mockFetch({
      objectTypeId: '2-custom',
      labels: { singular: 'Widget', plural: 'Widgets' },
      properties: [
        { name: 'widget_name', label: 'Widget Name', type: 'string' },
      ],
    }));
    const adapter = new HubSpotAdapter(getToken);
    const schema = await adapter.describe('2-custom');
    expect(schema.name).toBe('2-custom');
    expect(schema.fields).toHaveLength(1);
    expect(schema.fields[0]).toMatchObject({ name: 'widget_name', type: 'string' });
  });
});

describe('HubSpotAdapter — queryRecords', () => {
  it('yields records from a single page', async () => {
    vi.stubGlobal('fetch', mockFetch({
      results: [
        { id: 'c1', properties: { email: 'a@b.com' } },
        { id: 'c2', properties: { email: 'c@d.com' } },
      ],
    }));
    const adapter = new HubSpotAdapter(getToken);
    const records: unknown[] = [];
    for await (const rec of adapter.queryRecords('contacts', ['email'])) {
      records.push(rec);
    }
    expect(records).toHaveLength(2);
  });

  it('follows paging cursor', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true, status: 200,
        json: async () => ({
          results: [{ id: 'c1' }],
          paging: { next: { after: 'cursor-2' } },
        }),
        text: async () => '',
      })
      .mockResolvedValueOnce({
        ok: true, status: 200,
        json: async () => ({ results: [{ id: 'c2' }] }),
        text: async () => '',
      });
    vi.stubGlobal('fetch', fetchMock);
    const adapter = new HubSpotAdapter(getToken);
    const records: unknown[] = [];
    for await (const rec of adapter.queryRecords('contacts', ['email'])) {
      records.push(rec);
    }
    expect(records).toHaveLength(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    // second call must include the cursor in the request body
    const secondCallBody = JSON.parse((fetchMock.mock.calls[1][1] as RequestInit).body as string);
    expect(secondCallBody.after).toBe('cursor-2');
  });
});

describe('HubSpotAdapter — write methods', () => {
  it('throws HubSpotWriteNotSupportedError on upsertRecord', async () => {
    const adapter = new HubSpotAdapter(getToken);
    await expect(adapter.upsertRecord('contacts', {}, { get: () => undefined, set: () => {} }))
      .rejects.toBeInstanceOf(HubSpotWriteNotSupportedError);
  });

  it('throws HubSpotWriteNotSupportedError on deployMetadata', async () => {
    const adapter = new HubSpotAdapter(getToken);
    await expect(adapter.deployMetadata([]))
      .rejects.toBeInstanceOf(HubSpotWriteNotSupportedError);
  });

  it('throws HubSpotWriteNotSupportedError on uploadFile', async () => {
    const adapter = new HubSpotAdapter(getToken);
    await expect(adapter.uploadFile(Buffer.from(''), { name: 'f', contentType: 'text/plain' }, { objectName: 'contacts', recordId: 'c1' }))
      .rejects.toBeInstanceOf(HubSpotWriteNotSupportedError);
  });
});
