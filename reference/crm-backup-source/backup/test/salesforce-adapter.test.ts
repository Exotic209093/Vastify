import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SalesforceAdapter } from '../src/crm/salesforce-adapter.js';

const INSTANCE_URL = 'https://acme.my.salesforce.com';
const TOKEN = 'test-token';
const getToken = vi.fn().mockResolvedValue(TOKEN);

function mockFetch(responseBody: unknown, status = 200) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => responseBody,
    text: async () => JSON.stringify(responseBody),
    arrayBuffer: async () => Buffer.from('file-data').buffer,
  });
}

describe('SalesforceAdapter — listObjects', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('returns mapped ObjectDescriptors', async () => {
    vi.stubGlobal('fetch', mockFetch({
      sobjects: [
        { name: 'Account', label: 'Account', labelPlural: 'Accounts' },
        { name: 'Contact', label: 'Contact', labelPlural: 'Contacts' },
      ],
    }));
    const adapter = new SalesforceAdapter(INSTANCE_URL, getToken);
    const objects = await adapter.listObjects();
    expect(objects).toHaveLength(2);
    expect(objects[0]).toMatchObject({ name: 'Account', label: 'Account' });
  });
});

describe('SalesforceAdapter — describe', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('maps fields and child relationships', async () => {
    vi.stubGlobal('fetch', mockFetch({
      name: 'Account', label: 'Account',
      fields: [
        { name: 'Id', label: 'Account ID', type: 'id', referenceTo: [], nillable: false, externalId: false, relationshipName: null },
        { name: 'Name', label: 'Account Name', type: 'string', referenceTo: [], nillable: false, externalId: false, relationshipName: null },
      ],
      childRelationships: [
        { relationshipName: 'Contacts', childSObject: 'Contact', field: 'AccountId', cascadeDelete: false },
        { relationshipName: null, childSObject: 'Task', field: 'WhatId', cascadeDelete: false },
      ],
    }));
    const adapter = new SalesforceAdapter(INSTANCE_URL, getToken);
    const schema = await adapter.describe('Account');
    expect(schema.name).toBe('Account');
    expect(schema.fields).toHaveLength(2);
    expect(schema.childRelationships).toHaveLength(1);
    expect(schema.childRelationships[0]).toMatchObject({
      name: 'Contacts', childObject: 'Contact', childField: 'AccountId', type: 'lookup',
    });
  });

  it('marks master-detail relationship for cascadeDelete=true', async () => {
    vi.stubGlobal('fetch', mockFetch({
      name: 'Opportunity', label: 'Opportunity', fields: [],
      childRelationships: [
        { relationshipName: 'OpportunityLineItems', childSObject: 'OpportunityLineItem', field: 'OpportunityId', cascadeDelete: true },
      ],
    }));
    const adapter = new SalesforceAdapter(INSTANCE_URL, getToken);
    const schema = await adapter.describe('Opportunity');
    expect(schema.childRelationships[0].type).toBe('master-detail');
  });
});

describe('SalesforceAdapter — queryRecords', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('yields records from a single page', async () => {
    vi.stubGlobal('fetch', mockFetch({
      records: [{ Id: '001A', Name: 'Acme' }, { Id: '001B', Name: 'Beta' }],
      done: true,
    }));
    const adapter = new SalesforceAdapter(INSTANCE_URL, getToken);
    const records: unknown[] = [];
    for await (const rec of adapter.queryRecords('Account', ['Id', 'Name'])) {
      records.push(rec);
    }
    expect(records).toHaveLength(2);
    expect(records[0]).toMatchObject({ Id: '001A', Name: 'Acme' });
  });

  it('follows nextRecordsUrl for pagination', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true, status: 200,
        json: async () => ({
          records: [{ Id: '001A' }],
          done: false,
          nextRecordsUrl: '/services/data/v60.0/query/01g-page2',
        }),
        text: async () => '',
      })
      .mockResolvedValueOnce({
        ok: true, status: 200,
        json: async () => ({ records: [{ Id: '001B' }], done: true }),
        text: async () => '',
      });
    vi.stubGlobal('fetch', fetchMock);
    const adapter = new SalesforceAdapter(INSTANCE_URL, getToken);
    const records: unknown[] = [];
    for await (const rec of adapter.queryRecords('Account', ['Id'])) {
      records.push(rec);
    }
    expect(records).toHaveLength(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const secondCallUrl = (fetchMock as ReturnType<typeof vi.fn>).mock.calls[1][0] as string;
    expect(secondCallUrl).toBe('https://acme.my.salesforce.com/services/data/v60.0/query/01g-page2');
  });
});

describe('SalesforceAdapter — downloadFile', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('returns a Buffer from ContentVersion VersionData', async () => {
    const data = Buffer.from('PDF content here');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, status: 200,
      arrayBuffer: async () => data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength),
    }));
    const adapter = new SalesforceAdapter(INSTANCE_URL, getToken);
    const result = await adapter.downloadFile({ id: 'cv-1', name: 'doc.pdf', size: 16, contentType: 'application/pdf' });
    expect(result).toBeInstanceOf(Buffer);
    expect(result.toString()).toBe('PDF content here');
  });
});

describe('SalesforceAdapter — write methods', () => {
  it('throws BackupWriteNotImplementedError on upsertRecord', async () => {
    const adapter = new SalesforceAdapter(INSTANCE_URL, getToken);
    await expect(adapter.upsertRecord('Account', {}, { get: () => undefined, set: () => {} }))
      .rejects.toThrow('SalesforceAdapter.upsertRecord');
  });

  it('throws BackupWriteNotImplementedError on deployMetadata', async () => {
    const adapter = new SalesforceAdapter(INSTANCE_URL, getToken);
    await expect(adapter.deployMetadata([]))
      .rejects.toThrow('SalesforceAdapter.deployMetadata');
  });

  it('throws BackupWriteNotImplementedError on uploadFile', async () => {
    const adapter = new SalesforceAdapter(INSTANCE_URL, getToken);
    await expect(adapter.uploadFile(
      Buffer.from(''),
      { name: 'f', contentType: 'text/plain' },
      { objectName: 'Account', recordId: 'a1' },
    )).rejects.toThrow('SalesforceAdapter.uploadFile');
  });
});
