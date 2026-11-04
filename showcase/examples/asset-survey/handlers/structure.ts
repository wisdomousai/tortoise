import {
  ancestors,
  collectionCommandHandlers,
  collectionListHandler,
  collectionTreeHandler,
  own,
  type HandlerContribution,
} from '@tortoise/runtime';
import { designationProblem, normalizeDesignation } from '../contracts/schemes';
import { documents, nodes, structureOperations as ops } from '../contracts/structure';
import {
  captureBody,
  captures,
  type SurveyDocument,
  type SurveyNode,
  type SurveyState,
} from '../domain';
import {
  conflict,
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
const byDesignation = (a: SurveyNode, b: SurveyNode) => a.designation.localeCompare(b.designation);
const everyone = () => true;

/** A valid designation, unique among the active nodes of its scheme. */
function checkDesignation(ctx: Context, node: SurveyNode) {
  const problem = designationProblem(node.scheme, node.designation);
  if (problem) invalid('designation', problem);
  const clash = Object.values(ctx.state.nodes).find(
    (other) =>
      other.id !== node.id &&
      !other.retired &&
      other.scheme === node.scheme &&
      compactKey(other.designation) === compactKey(node.designation),
  );
  if (clash) conflict(`${node.designation} is already ${clash.name}`, { nodeId: clash.id });
}

/**
 * The structure's writes are generated from the node and document collections; the hooks keep
 * designations normalized and unique per scheme, and documents on nodes that exist. Reading a
 * node with its path, captures and documents, and searching designations, are the survey's.
 */
export const structureHandlers = (): HandlerContribution<SurveyState, SurveyServices>[] => [
  ...collectionCommandHandlers<SurveyState, SurveyServices, SurveyNode>(
    nodes,
    { create: ops.nodeCreate, update: ops.nodeUpdate, move: ops.nodeMove, retire: ops.nodeRetire },
    {
      store: (state) => state.nodes,
      present: nodeDto,
      newKey: newId,
      defaults: (ctx) => ({
        attributes: {},
        retired: false,
        createdBy: ctx.context.principalId,
        createdAt: now(ctx),
      }),
      normalize: (node) => ({ ...node, designation: normalizeDesignation(node.designation) }),
      validate(node, ctx, previous) {
        if (
          !node.retired &&
          (node.designation !== previous?.designation || node.scheme !== previous.scheme)
        )
          checkDesignation(ctx, node);
      },
    },
  ),
  collectionTreeHandler<SurveyState, SurveyServices, typeof ops.tree, SurveyNode>(nodes, ops.tree, {
    store: (state) => state.nodes,
    visible: everyone,
    present: nodeDto,
    order: byDesignation,
  }),
  ...collectionCommandHandlers<SurveyState, SurveyServices, SurveyDocument>(
    documents,
    { create: ops.documentCreate },
    {
      store: (state) => state.documents,
      newKey: newId,
      defaults: (ctx) => ({ addedBy: ctx.context.principalId, addedAt: now(ctx) }),
      validate(document, ctx) {
        if (document.nodeId) nodeRecords(ctx).getExisting(document.nodeId);
      },
    },
  ),
  collectionListHandler<SurveyState, SurveyServices, typeof ops.documentList, SurveyDocument>(
    documents,
    ops.documentList,
    {
      store: (state) => state.documents,
      visible: everyone,
      order: (a, b) => b.addedAt - a.addedAt,
    },
  ),
  handler(ops.nodeGet, (input, ctx) => {
    const node = nodeRecords(ctx).getExisting(input.id);
    return {
      ...nodeDto(node),
      path: ancestors(nodes, ctx.state.nodes, node.id).map(({ id, designation, name }) => ({
        id,
        designation,
        name,
      })),
      captures: captures(ctx.state)
        .filter((report) => report.subject === node.id)
        .map((report) => ({ report, body: captureBody(report) }))
        .sort((a, b) => b.body.takenAt - a.body.takenAt)
        .map(({ report, body }) => ({
          id: report.id,
          kind: body.kind,
          review: report.review,
          takenAt: body.takenAt,
        })),
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
          (input.scheme === undefined || node.scheme === input.scheme) &&
          (compactKey(node.designation).startsWith(key) ||
            (text.length > 0 && node.name.toLowerCase().includes(text))),
      )
      .sort(byDesignation)
      .slice(0, input.limit ?? 20);
    return { items: items.map(nodeDto) };
  }),
];

/** Whether a node exists and is active. */
export const activeNode = (state: SurveyState, id: string) => {
  const node = own(state.nodes, id);
  return node && !node.retired ? node : undefined;
};
