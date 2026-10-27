import type { z } from 'zod';
import { own, subtree as collectionSubtree } from '@agent-native/runtime';
import type {
  AssignmentSlice,
  StoredAssignment,
  StoredReport,
} from '@agent-native/assignments/server';
import type { ApprovalSlice } from '@agent-native/runtime';
import type { captureSchema, documentSchema, proposedFieldSchema } from './contracts/schemas';
import type { SchemeId } from './contracts/schemes';
import { nodes as nodeCollection } from './contracts/structure';

/**
 * Asset survey: a site structure prepared on the hub, captures of its equipment taken in the
 * field, values read from them by a model and checked by a person, and the result filed into the
 * enterprise asset management system.
 *
 * The hub owns the structure, reviewed attributes and filings. Field work and reading photos are
 * assignments: a survey goes to a paired device or a person, who reports one capture at a time;
 * an extraction goes to the model, which answers through its feed, or to a person. Neither
 * writes the structure; a person accepting a report does. The EAM decides about filings.
 */
export type Role = 'manager' | 'reviewer' | 'viewer';
export type Capture = z.output<typeof captureSchema>;
export type CaptureKind = Capture['kind'];
export type ProposedField = z.output<typeof proposedFieldSchema>;
export type SurveyDocument = z.output<typeof documentSchema>;
export interface Rejection {
  code: string;
  message: string;
}

export interface Attribute {
  value: string;
  /** The capture (survey report) the value was read from. */
  captureId?: string;
  edited: boolean;
}
export interface SurveyNode {
  id: string;
  parentId?: string;
  scheme: SchemeId;
  /** Normalized: trimmed, upper case, single spaces. */
  designation: string;
  name: string;
  attributes: Record<string, Attribute>;
  retired: boolean;
  assetId?: string;
  /** The asset's status in the EAM, from its feed. */
  assetStatus?: 'active' | 'retired';
  createdBy: string;
  createdAt: number;
}
export interface Filing {
  id: string;
  nodeId: string;
  designation: string;
  target: 'eam' | 'export';
  assetId?: string;
  withdraws?: string;
  withdrawnBy?: string;
  effectId: string;
  sync: 'pending' | 'accepted' | 'rejected';
  sorRef?: string;
  rejection?: Rejection;
  filedBy: string;
  filedAt: number;
}
export interface Cursor {
  watermark?: string;
  lastSyncAt?: number;
}
export interface SurveyState {
  integrationPrincipalId: string;
  members: Record<string, Role>;
  nodes: Record<string, SurveyNode>;
  documents: Record<string, SurveyDocument>;
  filings: Record<string, Filing>;
  cursors: { eam: Cursor };
  /** Surveys and extractions with their reports, kept by the assignment feature. */
  assignment?: AssignmentSlice;
  /** Requests for structure changes an agent prepared, kept by the approval feature. */
  approval?: ApprovalSlice;
}

export function createSurveyState(options: {
  ownerId: string;
  integrationPrincipalId: string;
  members?: Record<string, Role>;
}): SurveyState {
  return {
    integrationPrincipalId: options.integrationPrincipalId,
    members: options.members ?? { [options.ownerId]: 'manager' },
    nodes: {},
    documents: {},
    filings: {},
    cursors: { eam: {} },
  };
}

export const roleOf = (state: SurveyState, principalId: string) => own(state.members, principalId);

/** Field devices act as `device:<id>`; the device-link plugin authenticates them. */
export const DEVICE_PREFIX = 'device:';
export const deviceIdOf = (principalId: string) =>
  principalId.startsWith(DEVICE_PREFIX) ? principalId.slice(DEVICE_PREFIX.length) : undefined;

/** The node and every active node below it, depth first; nothing when the node is not active. */
export function subtree(nodes: Readonly<Record<string, SurveyNode>>, rootId: string) {
  const root = own(nodes, rootId);
  if (!root || root.retired) return [];
  return collectionSubtree(nodeCollection, nodes, rootId).filter((node) => !node.retired);
}

/** The scope a survey's planner fills in. */
export interface SurveyScope {
  roots: string[];
  kinds: CaptureKind[];
}
export const surveyScope = (assignment: Pick<StoredAssignment, 'scope'>) =>
  assignment.scope as unknown as SurveyScope;

/** Whether `nodeId` lies in one of the survey's subtrees as the structure stands now. */
export const inScope = (
  nodes: Readonly<Record<string, SurveyNode>>,
  scope: SurveyScope,
  nodeId: string,
) => scope.roots.some((root) => subtree(nodes, root).some((node) => node.id === nodeId));

/**
 * What a survey carries to the field: the kinds to capture and the slice of the structure it
 * covers. A root's parent is outside the slice, so the assignee sees it as a root.
 */
export function surveyBrief(nodes: Readonly<Record<string, SurveyNode>>, scope: SurveyScope) {
  const slice = new Map(
    scope.roots.flatMap((root) => subtree(nodes, root)).map((node) => [node.id, node]),
  );
  return {
    kinds: [...new Set(scope.kinds)],
    nodes: [...slice.values()].map(({ id, parentId, scheme, designation, name }) => ({
      id,
      ...(parentId && slice.has(parentId) ? { parentId } : {}),
      scheme,
      designation,
      name,
    })),
  };
}

/** The assignment slice, empty before the feature first wrote it. */
const sliceOf = (state: SurveyState): AssignmentSlice =>
  state.assignment ?? { assignments: {}, reports: {}, targets: {} };

/** A survey report: one capture. */
export const captureOf = (state: SurveyState, id: string) => {
  const report = own(sliceOf(state).reports, id);
  return report?.kind === 'survey' ? report : undefined;
};
export const captures = (state: SurveyState) =>
  Object.values(sliceOf(state).reports).filter((report) => report.kind === 'survey');
export const captureBody = (report: StoredReport) => report.body as unknown as Capture;

const newestFirst = (a: { createdAt: number; id: string }, b: { createdAt: number; id: string }) =>
  b.createdAt - a.createdAt || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0);

/**
 * Where the reading of one capture stands, from its newest extraction that was not withdrawn:
 * the newest report not discarded, or else whether the offer is still out or was refused.
 */
export function readingOf(state: SurveyState, captureId: string) {
  const slice = sliceOf(state);
  const extraction = Object.values(slice.assignments)
    .filter(
      (assignment) =>
        assignment.kind === 'extraction' &&
        assignment.status !== 'withdrawn' &&
        (assignment.scope as { reportId?: string }).reportId === captureId,
    )
    .sort(newestFirst)[0];
  if (!extraction) return undefined;
  const report = Object.values(slice.reports)
    .filter((entry) => entry.assignmentId === extraction.id && entry.review !== 'discarded')
    .sort((a, b) => b.reportedAt - a.reportedAt)[0];
  const status = report
    ? report.review === 'accepted'
      ? ('accepted' as const)
      : ('proposed' as const)
    : extraction.delivery === 'rejected'
      ? ('refused' as const)
      : extraction.status === 'sent'
        ? ('reading' as const)
        : undefined;
  return status && { extraction, report, status };
}

/** The values a reading proposed, by name. */
export const proposedValues = (report: StoredReport | undefined) =>
  new Map(
    ((report?.body.fields ?? []) as ProposedField[]).map((field) => [field.name, field.value]),
  );
