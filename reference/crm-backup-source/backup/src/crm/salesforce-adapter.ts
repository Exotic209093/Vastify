import type {
  CRMAdapter, ObjectDescriptor, ObjectSchema, CrmRecord,
  FileRef, IdRemap, MetadataItem, DeployResult,
} from './types.js';
import { BackupWriteNotImplementedError } from '../errors.js';

export class SalesforceAdapter implements CRMAdapter {
  constructor(
    private instanceUrl: string,
    private getToken: () => Promise<string>,
    private apiVersion = 'v60.0',
  ) {}

  private async apiFetch(path: string): Promise<Response> {
    const token = await this.getToken();
    let url: string;
    if (path.startsWith('http')) {
      url = path;
    } else if (path.startsWith('/services/')) {
      // Salesforce nextRecordsUrl is root-relative from the instance origin
      url = `${this.instanceUrl}${path}`;
    } else {
      url = `${this.instanceUrl}/services/data/${this.apiVersion}${path}`;
    }
    const resp = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    });
    if (!resp.ok) {
      throw new Error(`Salesforce API ${resp.status} on ${url}: ${await resp.text()}`);
    }
    return resp;
  }

  async listObjects(): Promise<ObjectDescriptor[]> {
    const resp = await this.apiFetch('/sobjects/');
    const json = await resp.json() as { sobjects: Array<{ name: string; label: string; labelPlural: string }> };
    return json.sobjects.map((s) => ({ name: s.name, label: s.label, labelPlural: s.labelPlural }));
  }

  async describe(objectName: string): Promise<ObjectSchema> {
    const resp = await this.apiFetch(`/sobjects/${objectName}/describe/`);
    const json = await resp.json() as {
      name: string;
      label: string;
      fields: Array<{
        name: string; label: string; type: string;
        referenceTo: string[]; relationshipName: string | null;
        nillable: boolean; externalId: boolean;
      }>;
      childRelationships: Array<{
        relationshipName: string | null;
        childSObject: string;
        field: string;
        cascadeDelete: boolean;
      }>;
    };

    return {
      name: json.name,
      label: json.label,
      fields: json.fields.map((f) => ({
        name: f.name,
        label: f.label,
        type: f.type,
        referenceTo: f.referenceTo ?? [],
        ...(f.relationshipName !== null && { relationshipName: f.relationshipName }),
        nillable: f.nillable,
        externalId: f.externalId,
      })),
      childRelationships: json.childRelationships
        .filter((r) => r.relationshipName !== null)
        .map((r) => ({
          name: r.relationshipName as string,
          type: r.cascadeDelete ? ('master-detail' as const) : ('lookup' as const),
          childObject: r.childSObject,
          childField: r.field,
        })),
    };
  }

  // Trusted internal API: fields and where come from schema introspection, never
  // from user input — they are interpolated into SOQL without escaping.
  async *queryRecords(objectName: string, fields: string[], where?: string): AsyncGenerator<CrmRecord> {
    const fieldList = fields.join(',');
    const whereClause = where ? ` WHERE ${where}` : '';
    const soql = `SELECT ${fieldList} FROM ${objectName}${whereClause}`;
    let url: string | null = `/query/?q=${encodeURIComponent(soql)}`;

    while (url) {
      const resp = await this.apiFetch(url);
      const json = await resp.json() as {
        records: CrmRecord[];
        done: boolean;
        nextRecordsUrl?: string;
      };
      for (const record of json.records) {
        yield record;
      }
      url = json.done ? null : (json.nextRecordsUrl ?? null);
    }
  }

  async downloadFile(fileRef: FileRef): Promise<Buffer> {
    const token = await this.getToken();
    const resp = await fetch(
      `${this.instanceUrl}/services/data/${this.apiVersion}/sobjects/ContentVersion/${fileRef.id}/VersionData`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!resp.ok) {
      throw new Error(`File download failed for ${fileRef.id}: ${resp.status}`);
    }
    return Buffer.from(await resp.arrayBuffer());
  }

  async upsertRecord(_objectName: string, _record: CrmRecord, _idRemap: IdRemap): Promise<string> {
    throw new BackupWriteNotImplementedError('SalesforceAdapter.upsertRecord');
  }

  async deployMetadata(_metadata: MetadataItem[]): Promise<DeployResult> {
    throw new BackupWriteNotImplementedError('SalesforceAdapter.deployMetadata');
  }

  async uploadFile(
    _file: Buffer,
    _meta: { name: string; contentType: string },
    _linkTo: { objectName: string; recordId: string },
  ): Promise<string> {
    throw new BackupWriteNotImplementedError('SalesforceAdapter.uploadFile');
  }
}
