import { z } from 'zod';
import { operation } from './operation';
import {
  designation,
  documentKind,
  documentLimits,
  documentSchema,
  nodeSchema,
  recordId,
  scheme,
  text,
  treeNodeSchema,
} from './schemas';

const node = { action: 'read', resourceType: 'SurveyNode' };
const edit = { action: 'edit', resourceType: 'SurveyNode' };

/** The site structure: nodes under reference designations, and the documents that describe them. */
export const structureOperations = {
  nodeCreate: operation('structure.node.create', 'command', {
    input: z.strictObject({
      parentId: recordId.optional(),
      scheme,
      designation,
      name: text(120),
    }),
    output: nodeSchema,
    permission: edit,
    description:
      'Add a node to the site structure under parentId (or as a root). The designation must follow its scheme: IEC 81346 (=G1-Q1), KKS (1LBA10AA101) or ANSI/IEEE C37.2 device numbers (52, 50/51N), and be unique among active nodes of that scheme.',
    dependencies: ['node'],
  }),
  nodeUpdate: operation('structure.node.update', 'command', {
    input: z.strictObject({
      id: recordId,
      designation: designation.optional(),
      name: text(120).optional(),
    }),
    output: nodeSchema,
    permission: edit,
    description:
      'Rename a node or correct its designation. Attributes change only by accepting an extraction.',
    dependencies: ['node'],
  }),
  nodeMove: operation('structure.node.move', 'command', {
    input: z.strictObject({ id: recordId, parentId: recordId.nullable() }),
    output: nodeSchema,
    permission: edit,
    description:
      'Move a node and its subtree under another parent, or to the root with parentId null. A node cannot move under itself or its own descendants.',
    dependencies: ['node'],
  }),
  nodeRetire: operation('structure.node.retire', 'command', {
    input: z.strictObject({ id: recordId }),
    output: nodeSchema,
    permission: edit,
    description:
      'Retire a node that no longer exists on site. It keeps its history and captures but leaves the tree, searches and field assignments; its children must be retired or moved first.',
    dependencies: ['node'],
  }),
  nodePropose: operation('structure.node.propose', 'command', {
    input: z.strictObject({
      parentId: recordId.optional(),
      scheme,
      designation,
      name: text(120),
      documentId: recordId.optional(),
    }),
    output: nodeSchema,
    permission: { action: 'propose', resourceType: 'SurveyNode' },
    description:
      'Propose a node read from a document or a capture, for a manager to accept with structure.node.accept. Agents propose; they do not create. A proposed node is shown apart and is not sent to the field.',
    dependencies: ['node'],
    exception:
      'proposed by agents reading documents and captures; people accept on the structure screen',
  }),
  nodeAccept: operation('structure.node.accept', 'command', {
    input: z.strictObject({ id: recordId }),
    output: nodeSchema,
    permission: edit,
    description: 'Accept a proposed node into the structure.',
    dependencies: ['node'],
  }),
  tree: operation('structure.tree', 'query', {
    input: z.strictObject({ rootId: recordId.optional(), includeRetired: z.boolean().optional() }),
    output: z.strictObject({ nodes: z.array(treeNodeSchema) }),
    permission: node,
    description:
      'The structure depth first from rootId (or every root), each node with its depth. Retired nodes are left out unless includeRetired is true.',
    dependencies: ['node'],
  }),
  nodeGet: operation('structure.node.get', 'query', {
    input: z.strictObject({ id: recordId }),
    output: z.strictObject({
      ...nodeSchema.shape,
      path: z.array(z.strictObject({ id: recordId, designation: z.string(), name: z.string() })),
      captures: z.array(
        z.strictObject({
          id: recordId,
          kind: z.string(),
          review: z.string(),
          takenAt: z.number(),
        }),
      ),
      documents: z.array(documentSchema),
    }),
    permission: node,
    description:
      'One node with its path from the root, its accepted attributes with the capture each came from, its captures and documents.',
    dependencies: ['node', 'capture', 'document'],
  }),
  nodeSearch: operation('structure.node.search', 'query', {
    input: z.strictObject({
      q: z.string().max(64),
      scheme: scheme.optional(),
      limit: z.number().int().min(1).max(50).optional(),
    }),
    output: z.strictObject({ items: z.array(nodeSchema) }),
    permission: node,
    description:
      'Find active nodes whose designation starts with q (spaces and case ignored) or whose name contains it. Use it to resolve a scanned tag or a designation read from a nameplate.',
    dependencies: ['node'],
  }),
  documentAdd: operation('document.add', 'command', {
    input: z.strictObject({
      title: text(200),
      kind: documentKind,
      file: documentSchema.shape.file,
      pages: z.number().int().positive().max(2000).optional(),
      nodeId: recordId.optional(),
    }),
    output: documentSchema,
    permission: { action: 'edit', resourceType: 'SurveyDocument' },
    description:
      'File a schematic, plan, datasheet or manual (PDF or image, uploaded first as a blob) and optionally attach it to a node.',
    dependencies: ['document'],
    blobs: documentLimits,
  }),
  documentList: operation('document.list', 'query', {
    input: z.strictObject({ nodeId: recordId.optional() }),
    output: z.strictObject({ items: z.array(documentSchema) }),
    permission: { action: 'read', resourceType: 'SurveyDocument' },
    description: 'The documents of the survey, or of one node, newest first.',
    dependencies: ['document'],
  }),
} as const;
