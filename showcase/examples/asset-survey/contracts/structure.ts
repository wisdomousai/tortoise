import { z } from 'zod';
import {
  collectionCreate,
  collectionList,
  collectionMove,
  collectionRetire,
  collectionTree,
  collectionUpdate,
  defineCollection,
} from '@tortoise/contracts';
import { operation } from './operation';
import { documentLimits, documentSchema, nodeSchema, recordId, scheme } from './schemas';

/** The site structure: nodes under reference designations, one tree per root. */
export const nodes = defineCollection({
  type: 'node',
  resourceType: 'SurveyNode',
  item: nodeSchema,
  label: { one: 'Node', many: 'Nodes' },
  titleField: 'designation',
  parent: 'parentId',
  retiredField: 'retired',
});

/** Schematics, plans, datasheets and manuals of the site, each optionally on a node. */
export const documents = defineCollection({
  type: 'document',
  resourceType: 'SurveyDocument',
  item: documentSchema,
  label: { one: 'Document', many: 'Documents' },
  titleField: 'title',
});

const read = { action: 'read', resourceType: 'SurveyNode' };

/**
 * The structure's writes and tree are generated from the collection; the hub's hooks normalize
 * designations and keep them unique per scheme. Reading one node with its path, captures and
 * documents, and searching designations, are the survey's own.
 */
export const structureOperations = {
  nodeCreate: collectionCreate(nodes, {
    id: 'structure.node',
    fields: ['parentId', 'scheme', 'designation', 'name'],
    action: 'edit',
    description:
      'Add a node to the site structure under parentId (or as a root). The designation must follow its scheme: IEC 81346 (=G1-Q1), KKS (1LBA10AA101) or ANSI/IEEE C37.2 device numbers (52, 50/51N), and be unique among active nodes of that scheme. Agents request approval for it instead of running it.',
  }),
  nodeUpdate: collectionUpdate(nodes, {
    id: 'structure.node',
    fields: ['designation', 'name'],
    action: 'edit',
    description:
      'Rename a node or correct its designation. Attributes change only by accepting a capture.',
  }),
  nodeMove: collectionMove(nodes, {
    id: 'structure.node',
    action: 'edit',
    description:
      'Move a node and its subtree under another parent, or to the root with parentId null. A node cannot move under itself or its own descendants.',
  }),
  nodeRetire: collectionRetire(nodes, {
    id: 'structure.node',
    action: 'edit',
    description:
      'Retire a node that no longer exists on site. It keeps its history and captures but leaves the tree, searches and new surveys; its children must be retired or moved first.',
  }),
  tree: collectionTree(nodes, {
    id: 'structure',
    description:
      'The structure depth first from root (or every root), each node with its depth. Retired nodes are left out unless includeRetired is true.',
  }),
  nodeGet: operation('structure.node.get', 'query', {
    input: z.strictObject({ id: recordId }),
    output: z.strictObject({
      ...nodeSchema.shape,
      path: z.array(z.strictObject({ id: recordId, designation: z.string(), name: z.string() })),
      captures: z.array(
        z.strictObject({
          id: z.string(),
          kind: z.string(),
          review: z.string(),
          takenAt: z.number(),
        }),
      ),
      documents: z.array(documentSchema),
    }),
    permission: read,
    description:
      'One node with its path from the root, its accepted attributes with the capture each came from, its captures and documents.',
    dependencies: ['node', 'assignment-report', 'document'],
  }),
  nodeSearch: operation('structure.node.search', 'query', {
    input: z.strictObject({
      q: z.string().max(64),
      scheme: scheme.optional(),
      limit: z.number().int().min(1).max(50).optional(),
    }),
    output: z.strictObject({ items: z.array(nodeSchema) }),
    permission: read,
    description:
      'Find active nodes whose designation starts with q (spaces and case ignored) or whose name contains it. Use it to resolve a scanned tag or a designation read from a nameplate.',
    dependencies: ['node'],
  }),
  documentCreate: collectionCreate(documents, {
    id: 'document',
    fields: ['title', 'kind', 'file', 'pages', 'nodeId'],
    blobs: documentLimits,
    action: 'edit',
    description:
      'File a schematic, plan, datasheet or manual (PDF or image, uploaded first as a blob) and optionally attach it to a node.',
    dependencies: ['node'],
  }),
  documentList: collectionList(documents, {
    id: 'document',
    filters: ['nodeId', 'kind'],
    description: 'The documents of the survey, or of one node, newest first.',
  }),
} as const;
