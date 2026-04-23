import type { CRMAdapter, FieldDescriptor } from './crm/types.js';

export interface SchemaNode {
  objectName: string;
  depth: number;
  fields: FieldDescriptor[];
}

export interface SchemaEdge {
  parentObject: string;
  childObject: string;
  relationshipName: string;
  childField: string;
  type: 'lookup' | 'master-detail' | 'junction';
  isCycleBreak: boolean;
}

export interface SchemaGraph {
  rootObject: string;
  nodes: Map<string, SchemaNode>;
  edges: SchemaEdge[];
}

export async function walkSchema(
  adapter: Pick<CRMAdapter, 'describe'>,
  rootObject: string,
  maxDepth: number,
): Promise<SchemaGraph> {
  const nodes = new Map<string, SchemaNode>();
  const edges: SchemaEdge[] = [];
  const inStack = new Set<string>();

  async function visit(objectName: string, depth: number): Promise<void> {
    if (depth > maxDepth) return;
    if (nodes.has(objectName)) return;

    inStack.add(objectName);
    const schema = await adapter.describe(objectName);
    nodes.set(objectName, { objectName, depth, fields: schema.fields });

    for (const rel of schema.childRelationships) {
      const isCycleBreak = inStack.has(rel.childObject);
      edges.push({
        parentObject: objectName,
        childObject: rel.childObject,
        relationshipName: rel.name,
        childField: rel.childField,
        type: rel.type,
        isCycleBreak,
      });
      if (!isCycleBreak) {
        await visit(rel.childObject, depth + 1);
      }
    }

    inStack.delete(objectName);
  }

  await visit(rootObject, 0);
  return { rootObject, nodes, edges };
}
