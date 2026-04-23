import type {
  CRMAdapter, ObjectDescriptor, ObjectSchema, CrmRecord,
  FileRef, IdRemap, MetadataItem, DeployResult,
} from './types.js';
import { HubSpotWriteNotSupportedError } from '../errors.js';

const STANDARD_OBJECTS: ObjectDescriptor[] = [
  { name: 'contacts', label: 'Contact', labelPlural: 'Contacts' },
  { name: 'companies', label: 'Company', labelPlural: 'Companies' },
  { name: 'deals', label: 'Deal', labelPlural: 'Deals' },
  { name: 'tickets', label: 'Ticket', labelPlural: 'Tickets' },
  { name: 'products', label: 'Product', labelPlural: 'Products' },
  { name: 'line_items', label: 'Line Item', labelPlural: 'Line Items' },
];

const STANDARD_OBJECT_NAMES = new Set(STANDARD_OBJECTS.map((o) => o.name));

export class HubSpotAdapter implements CRMAdapter {
  constructor(private getToken: () => Promise<string>) {}

  private async apiFetch(path: string, init?: RequestInit): Promise<Response> {
    const token = await this.getToken();
    const resp = await fetch(`https://api.hubapi.com${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...(init?.headers ?? {}),
      },
    });
    if (!resp.ok) {
      throw new Error(`HubSpot API ${resp.status} on ${path}: ${await resp.text()}`);
    }
    return resp;
  }

  async listObjects(): Promise<ObjectDescriptor[]> {
    const resp = await this.apiFetch('/crm/v3/schemas');
    const json = await resp.json() as {
      results: Array<{
        objectTypeId: string;
        name: string;
        labels: { singular: string; plural: string };
      }>;
    };
    const custom = json.results.map((s) => ({
      name: s.objectTypeId,
      label: s.labels.singular,
      labelPlural: s.labels.plural,
    }));
    return [...STANDARD_OBJECTS, ...custom];
  }

  async describe(objectName: string): Promise<ObjectSchema> {
    if (STANDARD_OBJECT_NAMES.has(objectName)) {
      const resp = await this.apiFetch(`/crm/v3/properties/${objectName}`);
      const json = await resp.json() as {
        results: Array<{ name: string; label: string; type: string }>;
      };
      return {
        name: objectName,
        label: objectName,
        fields: json.results.map((f) => ({
          name: f.name, label: f.label, type: f.type,
          referenceTo: [], nillable: true, externalId: false,
        })),
        childRelationships: [],
      };
    }

    const resp = await this.apiFetch(`/crm/v3/schemas/${objectName}`);
    const json = await resp.json() as {
      objectTypeId?: string;
      labels?: { singular: string; plural: string };
      properties?: Array<{ name: string; label: string; type: string }>;
    };
    return {
      name: json.objectTypeId ?? objectName,
      label: json.labels?.singular ?? objectName,
      fields: (json.properties ?? []).map((f) => ({
        name: f.name, label: f.label, type: f.type,
        referenceTo: [], nillable: true, externalId: false,
      })),
      childRelationships: [],
    };
  }

  // Trusted internal API: fields come from schema introspection, never from user input.
  async *queryRecords(objectName: string, fields: string[], _where?: string): AsyncGenerator<CrmRecord> {
    let after: string | undefined;

    while (true) {
      const body: Record<string, unknown> = { properties: fields, limit: 100 };
      if (after) body.after = after;

      const resp = await this.apiFetch(`/crm/v3/objects/${objectName}/search`, {
        method: 'POST',
        body: JSON.stringify(body),
      });
      const json = await resp.json() as {
        results: CrmRecord[];
        paging?: { next?: { after: string } };
      };

      for (const record of json.results) {
        yield record;
      }

      after = json.paging?.next?.after;
      if (!after) break;
    }
  }

  async downloadFile(_fileRef: FileRef): Promise<Buffer> {
    throw new Error('HubSpot file downloads use URLs from record properties, not FileRef IDs');
  }

  async upsertRecord(_objectName: string, _record: CrmRecord, _idRemap: IdRemap): Promise<string> {
    throw new HubSpotWriteNotSupportedError();
  }

  async deployMetadata(_metadata: MetadataItem[]): Promise<DeployResult> {
    throw new HubSpotWriteNotSupportedError();
  }

  async uploadFile(
    _file: Buffer,
    _meta: { name: string; contentType: string },
    _linkTo: { objectName: string; recordId: string },
  ): Promise<string> {
    throw new HubSpotWriteNotSupportedError();
  }
}
