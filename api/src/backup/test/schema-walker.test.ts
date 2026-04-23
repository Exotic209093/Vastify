import { describe, it, expect } from 'bun:test';
import { walkSchema } from '../schema-walker.js';
import type { ObjectSchema } from '../crm/types.js';

function makeAdapter(schemas: Record<string, ObjectSchema>) {
  return {
    describe: async (name: string) => {
      const schema = schemas[name];
      if (!schema) throw new Error(`Unknown object: ${name}`);
      return schema;
    },
  };
}

const FLAT_SCHEMA: Record<string, ObjectSchema> = {
  Account: {
    name: 'Account', label: 'Account',
    fields: [{ name: 'Id', label: 'ID', type: 'id', referenceTo: [], nillable: false, externalId: false }],
    childRelationships: [
      { name: 'Contacts', type: 'lookup', childObject: 'Contact', childField: 'AccountId' },
    ],
  },
  Contact: {
    name: 'Contact', label: 'Contact',
    fields: [{ name: 'Id', label: 'ID', type: 'id', referenceTo: [], nillable: false, externalId: false }],
    childRelationships: [],
  },
};

const DEEP_SCHEMA: Record<string, ObjectSchema> = {
  Account: {
    name: 'Account', label: 'Account',
    fields: [{ name: 'Id', label: 'ID', type: 'id', referenceTo: [], nillable: false, externalId: false }],
    childRelationships: [
      { name: 'Opportunities', type: 'lookup', childObject: 'Opportunity', childField: 'AccountId' },
    ],
  },
  Opportunity: {
    name: 'Opportunity', label: 'Opportunity',
    fields: [{ name: 'Id', label: 'ID', type: 'id', referenceTo: [], nillable: false, externalId: false }],
    childRelationships: [
      { name: 'OpportunityLineItems', type: 'master-detail', childObject: 'OpportunityLineItem', childField: 'OpportunityId' },
    ],
  },
  OpportunityLineItem: {
    name: 'OpportunityLineItem', label: 'Line Item',
    fields: [{ name: 'Id', label: 'ID', type: 'id', referenceTo: [], nillable: false, externalId: false }],
    childRelationships: [],
  },
};

const DIAMOND_SCHEMA: Record<string, ObjectSchema> = {
  Account: {
    name: 'Account', label: 'Account', fields: [],
    childRelationships: [
      { name: 'Contacts', type: 'lookup', childObject: 'Contact', childField: 'AccountId' },
      { name: 'Opportunities', type: 'lookup', childObject: 'Opportunity', childField: 'AccountId' },
    ],
  },
  Contact: {
    name: 'Contact', label: 'Contact', fields: [],
    childRelationships: [
      { name: 'Owners', type: 'lookup', childObject: 'User', childField: 'OwnerId' },
    ],
  },
  Opportunity: {
    name: 'Opportunity', label: 'Opportunity', fields: [],
    childRelationships: [
      { name: 'Owners', type: 'lookup', childObject: 'User', childField: 'OwnerId' },
    ],
  },
  User: {
    name: 'User', label: 'User', fields: [], childRelationships: [],
  },
};

const CYCLIC_SCHEMA: Record<string, ObjectSchema> = {
  A: {
    name: 'A', label: 'A', fields: [],
    childRelationships: [{ name: 'Bs', type: 'lookup', childObject: 'B', childField: 'A_Id' }],
  },
  B: {
    name: 'B', label: 'B', fields: [],
    childRelationships: [{ name: 'As', type: 'lookup', childObject: 'A', childField: 'B_Id' }],
  },
};

describe('SchemaWalker', () => {
  it('discovers root node and immediate children', async () => {
    const graph = await walkSchema(makeAdapter(FLAT_SCHEMA), 'Account', 3);
    expect(graph.nodes.has('Account')).toBe(true);
    expect(graph.nodes.has('Contact')).toBe(true);
    expect(graph.edges).toHaveLength(1);
    expect(graph.edges[0]).toMatchObject({ parentObject: 'Account', childObject: 'Contact', isCycleBreak: false });
    expect(graph.rootObject).toBe('Account');
  });

  it('discovers multi-level tree', async () => {
    const graph = await walkSchema(makeAdapter(DEEP_SCHEMA), 'Account', 3);
    expect(graph.nodes.has('Account')).toBe(true);
    expect(graph.nodes.has('Opportunity')).toBe(true);
    expect(graph.nodes.has('OpportunityLineItem')).toBe(true);
  });

  it('respects maxDepth and stops descending', async () => {
    const graph = await walkSchema(makeAdapter(DEEP_SCHEMA), 'Account', 1);
    expect(graph.nodes.has('Account')).toBe(true);
    expect(graph.nodes.has('Opportunity')).toBe(true);
    expect(graph.nodes.has('OpportunityLineItem')).toBe(false);
  });

  it('breaks cycles without throwing', async () => {
    const graph = await walkSchema(makeAdapter(CYCLIC_SCHEMA), 'A', 5);
    expect(graph.nodes.has('A')).toBe(true);
    expect(graph.nodes.has('B')).toBe(true);
    const cycleEdges = graph.edges.filter((e) => e.isCycleBreak);
    expect(cycleEdges.length).toBeGreaterThan(0);
  });

  it('handles diamond graph — shared child node visited once, not marked as cycle break', async () => {
    let describeCalls = 0;
    const adapter = {
      describe: async (name: string) => {
        describeCalls++;
        const schema = DIAMOND_SCHEMA[name];
        if (!schema) throw new Error(`Unknown: ${name}`);
        return schema;
      },
    };
    const graph = await walkSchema(adapter, 'Account', 5);
    expect(graph.nodes.has('User')).toBe(true);
    expect(describeCalls).toBe(4);
    const userEdges = graph.edges.filter((e) => e.childObject === 'User');
    expect(userEdges).toHaveLength(2);
    expect(userEdges.every((e) => !e.isCycleBreak)).toBe(true);
  });

  it('does not make redundant describe calls for already-visited objects', async () => {
    let describeCalls = 0;
    const adapter = {
      describe: async (name: string) => {
        describeCalls++;
        return FLAT_SCHEMA[name] ?? { name, label: name, fields: [], childRelationships: [] };
      },
    };
    await walkSchema(adapter, 'Account', 5);
    expect(describeCalls).toBe(2);
  });
});
