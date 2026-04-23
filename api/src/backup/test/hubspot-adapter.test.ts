import { describe, it, expect, mock, afterEach, spyOn } from 'bun:test';
import { HubSpotAdapter } from '../crm/hubspot-adapter.js';
import { HubSpotWriteNotSupportedError } from '../errors.js';

const getToken = mock(() => Promise.resolve('hs-token'));

function mockFetchResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

afterEach(() => { (globalThis.fetch as unknown as ReturnType<typeof mock>).mockRestore?.(); });

describe('HubSpotAdapter — listObjects', () => {
  it('includes standard objects plus custom schemas', async () => {
    spyOn(globalThis, 'fetch').mockResolvedValue(mockFetchResponse({
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
    spyOn(globalThis, 'fetch').mockResolvedValue(mockFetchResponse({
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
    spyOn(globalThis, 'fetch').mockResolvedValue(mockFetchResponse({
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
    spyOn(globalThis, 'fetch').mockResolvedValue(mockFetchResponse({
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
    const fetchSpy = spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce({
        ok: true, status: 200,
        json: async () => ({
          results: [{ id: 'c1' }],
          paging: { next: { after: 'cursor-2' } },
        }),
        text: async () => '',
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: true, status: 200,
        json: async () => ({ results: [{ id: 'c2' }] }),
        text: async () => '',
      } as unknown as Response);

    const adapter = new HubSpotAdapter(getToken);
    const records: unknown[] = [];
    for await (const rec of adapter.queryRecords('contacts', ['email'])) {
      records.push(rec);
    }
    expect(records).toHaveLength(2);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    const secondCallBody = JSON.parse((fetchSpy.mock.calls[1][1] as RequestInit).body as string) as Record<string, unknown>;
    expect(secondCallBody['after']).toBe('cursor-2');
    fetchSpy.mockRestore();
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
    await expect(adapter.uploadFile(
      new Uint8Array(0),
      { name: 'f', contentType: 'text/plain' },
      { objectName: 'contacts', recordId: 'c1' },
    )).rejects.toBeInstanceOf(HubSpotWriteNotSupportedError);
  });
});
