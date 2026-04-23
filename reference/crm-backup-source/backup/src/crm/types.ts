export interface ObjectDescriptor {
  name: string;
  label: string;
  labelPlural: string;
}

export interface FieldDescriptor {
  name: string;
  label: string;
  type: string;
  referenceTo: string[];
  relationshipName?: string;
  nillable: boolean;
  externalId: boolean;
}

export interface RelationshipDescriptor {
  name: string;
  type: 'lookup' | 'master-detail' | 'junction';
  childObject: string;
  childField: string;
}

export interface ObjectSchema {
  name: string;
  label: string;
  fields: FieldDescriptor[];
  childRelationships: RelationshipDescriptor[];
}

export type CrmRecord = Record<string, unknown>;

export interface FileRef {
  id: string;
  name: string;
  size: number;
  contentType: string;
}

export interface IdRemap {
  get(sourceId: string): string | undefined;
  set(sourceId: string, targetId: string): void;
}

export interface MetadataItem {
  type: string;
  fullName: string;
  body: Record<string, unknown>;
}

export interface DeployResult {
  success: boolean;
  errors: Array<{ name: string; message: string }>;
}

export interface CRMAdapter {
  listObjects(): Promise<ObjectDescriptor[]>;
  describe(objectName: string): Promise<ObjectSchema>;
  queryRecords(objectName: string, fields: string[], where?: string): AsyncGenerator<CrmRecord>;
  downloadFile(fileRef: FileRef): Promise<Buffer>;
  upsertRecord(objectName: string, record: CrmRecord, idRemap: IdRemap): Promise<string>;
  deployMetadata(metadata: MetadataItem[]): Promise<DeployResult>;
  uploadFile(
    file: Buffer,
    meta: { name: string; contentType: string },
    linkTo: { objectName: string; recordId: string },
  ): Promise<string>;
}
