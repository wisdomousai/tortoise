import { own, type HandlerContribution } from '@agent-native/runtime';
import { structureOperations as ops } from '../contracts/structure';
import { designationProblem, normalizeDesignation, type SchemeId } from '../contracts/schemes';
import { childrenOf, type SurveyNode, type SurveyState } from '../domain';
import {
  compact,
  conflict,
  documentRecords,
  handler,
  invalid,
  newId,
  nodeDto,
  nodeRecords,
  now,
  type Context,
  type SurveyServices,
} from './context';

const compactKey = (designation: string) => normalizeDesignation(designation).replaceAll(' ', '');

/** A valid designation, unique among the active nodes of its scheme, normalized for storage. */
function checkedDesignation(ctx: Context, scheme: SchemeId, designation: string, self?: string) {
  const problem = designationProblem(scheme, designation);
  if (problem) invalid('designation', problem);
  const normalized = normalizeDesignation(designation);
  const clash = Object.values(ctx.state.nodes).find(
    (node) =>
      node.id !== self &&
      !node.retired &&
      node.scheme === scheme &&
      compactKey(node.designation) === compactKey(normalized),
  );
  if (clash) conflict(`${normalized} is already ${clash.name}`, { nodeId: clash.id });
  return normalized;
}

/** An active parent that is part of the structure, not a proposal. */
function checkedParent(ctx: Context, parentId: string | undefined) {
  if (parentId === undefined) return;
  const parent = nodeRecords(ctx).getExisting(parentId, 'Parent node unavailable');
  if (parent.retired) conflict('Parent node is retired');
  if (parent.source === 'proposed') conflict('Accept the parent node first');
}

function addNode(
  ctx: Context,
  input: { parentId?: string | undefined; scheme: SchemeId; designation: string; name: string },
  source: SurveyNode['source'],
  documentId?: string,
) {
  checkedParent(ctx, input.parentId);
  const designation = checkedDesignation(ctx, input.scheme, input.designation);
  const id = newId(ctx);
  const node = nodeRecords(ctx).insert(
    id,
    compact({
      id,
      parentId: input.parentId,
      scheme: input.scheme,
      designation,
      name: input.name,
      source,
      attributes: {},
      retired: false,
      documentId,
      createdBy: ctx.context.principalId,
      createdAt: now(ctx),
    }),
    source === 'proposed' ? 'proposed' : 'created',
  );
  return nodeDto(node);
}

/** The node and its descendants depth first, each with its depth below the start. */
function walk(
  state: SurveyState,
  node: SurveyNode,
  depth: number,
  retired: boolean,
): (SurveyNode & { depth: number })[] {
  const children = Object.values(state.nodes)
    .filter((child) => child.parentId === node.id && (retired || !child.retired))
    .sort((a, b) => a.designation.localeCompare(b.designation));
  return [
    { ...node, depth },
    ...children.flatMap((child) => walk(state, child, depth + 1, retired)),
  ];
}

export const structureHandlers = (): HandlerContribution<SurveyState, SurveyServices>[] => [
  handler(ops.nodeCreate, (input, ctx) => addNode(ctx, input, 'manual')),
  handler(ops.nodePropose, (input, ctx) => {
    if (input.documentId) documentRecords(ctx).getExisting(input.documentId);
    return addNode(ctx, input, 'proposed', input.documentId);
  }),
  handler(ops.nodeAccept, (input, ctx) => {
    const nodes = nodeRecords(ctx);
    const node = nodes.getExisting(input.id);
    if (node.source !== 'proposed') conflict(`Node is ${node.source}`);
    checkedParent(ctx, node.parentId);
    return nodeDto(nodes.update(input.id, { source: 'accepted' }, 'accepted'));
  }),
  handler(ops.nodeUpdate, (input, ctx) => {
    const nodes = nodeRecords(ctx);
    const node = nodes.getExisting(input.id);
    if (node.retired) conflict('Node is retired');
    const designation =
      input.designation === undefined
        ? node.designation
        : checkedDesignation(ctx, node.scheme, input.designation, node.id);
    return nodeDto(
      nodes.update(input.id, { designation, name: input.name ?? node.name }, 'updated'),
    );
  }),
  handler(ops.nodeMove, (input, ctx) => {
    const nodes = nodeRecords(ctx);
    const node = nodes.getExisting(input.id);
    const parentId = input.parentId ?? undefined;
    checkedParent(ctx, parentId);
    // Walk up from the new parent: reaching the node means it would move under itself.
    for (let at = parentId; at !== undefined; at = own(ctx.state.nodes, at)?.parentId)
      if (at === node.id) invalid('parentId', 'A node cannot move under itself');
    return nodeDto(
      nodes.update(
        input.id,
        (record) => {
          if (parentId === undefined) delete record.parentId;
          else record.parentId = parentId;
        },
        'moved',
      ),
    );
  }),
  handler(ops.nodeRetire, (input, ctx) => {
    const nodes = nodeRecords(ctx);
    const node = nodes.getExisting(input.id);
    if (childrenOf(ctx.state, node.id).length)
      conflict('Retire or move the children first', {
        children: childrenOf(ctx.state, node.id).length,
      });
    return nodeDto(nodes.update(input.id, { retired: true }, 'retired'));
  }),
  handler(ops.tree, (input, ctx) => {
    const retired = input.includeRetired ?? false;
    const starts = input.rootId
      ? [nodeRecords(ctx).getExisting(input.rootId)]
      : Object.values(ctx.state.nodes)
          .filter((node) => node.parentId === undefined && (retired || !node.retired))
          .sort((a, b) => a.designation.localeCompare(b.designation));
    return {
      nodes: starts
        .flatMap((node) => walk(ctx.state, node, 0, retired))
        .map(({ depth, ...node }) => ({ ...nodeDto(node), depth })),
    };
  }),
  handler(ops.nodeGet, (input, ctx) => {
    const node = nodeRecords(ctx).getExisting(input.id);
    const path: { id: string; designation: string; name: string }[] = [];
    for (
      let at = own(ctx.state.nodes, node.parentId ?? '');
      at;
      at = own(ctx.state.nodes, at.parentId ?? '')
    )
      path.unshift({ id: at.id, designation: at.designation, name: at.name });
    return {
      ...nodeDto(node),
      path,
      captures: Object.values(ctx.state.captures)
        .filter((capture) => capture.nodeId === node.id)
        .sort((a, b) => b.takenAt - a.takenAt)
        .map(({ id, kind, review, takenAt }) => ({ id, kind, review, takenAt })),
      documents: Object.values(ctx.state.documents)
        .filter((document) => document.nodeId === node.id)
        .sort((a, b) => b.addedAt - a.addedAt),
    };
  }),
  handler(ops.nodeSearch, (input, ctx) => {
    const key = compactKey(input.q);
    const text = input.q.trim().toLowerCase();
    const items = Object.values(ctx.state.nodes)
      .filter(
        (node) =>
          !node.retired &&
          node.source !== 'proposed' &&
          (input.scheme === undefined || node.scheme === input.scheme) &&
          (compactKey(node.designation).startsWith(key) ||
            (text.length > 0 && node.name.toLowerCase().includes(text))),
      )
      .sort((a, b) => a.designation.localeCompare(b.designation))
      .slice(0, input.limit ?? 20);
    return { items: items.map(nodeDto) };
  }),
  handler(ops.documentAdd, (input, ctx) => {
    if (input.nodeId) nodeRecords(ctx).getExisting(input.nodeId);
    const documents = documentRecords(ctx);
    const id = newId(ctx);
    // The upload becomes readable through the document: whoever may read it may read the file.
    ctx.attach(documents.resource(id), input.file);
    return documents.insert(
      id,
      compact({ id, ...input, addedBy: ctx.context.principalId, addedAt: now(ctx) }),
      'added',
    );
  }),
  handler(ops.documentList, (input, ctx) => ({
    items: Object.values(ctx.state.documents)
      .filter((document) => input.nodeId === undefined || document.nodeId === input.nodeId)
      .sort((a, b) => b.addedAt - a.addedAt),
  })),
];
