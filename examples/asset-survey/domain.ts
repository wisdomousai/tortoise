import { own } from '@agent-native/runtime';
import type { BlobRef } from '@agent-native/contracts';
import type { SchemeId } from './contracts/schemes';

/**
 * Asset survey: a site structure prepared on the hub, captures of its equipment taken in the
 * field, values read from them by a model and checked by a person, and the result filed into the
 * enterprise asset management system.
 *
 * The hub owns the structure, assignments, reviewed attributes and filings. Field devices own
 * their captures until the hub ingests them. The model proposes and the EAM decides; neither
 * writes here except through the integration principal's settle and sync commands.
 */
export type Role = 'manager' | 'reviewer' | 'viewer';
export type CaptureKind = 'nameplate' | 'overview' | 'label' | 'defect' | 'schematic';
export interface Rejection {
  code: string;
  message: string;
}

export interface Attribute {
  value: string;
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
  source: 'manual' | 'proposed' | 'accepted';
  attributes: Record<string, Attribute>;
  retired: boolean;
  documentId?: string;
  assetId?: string;
  /** The asset's status in the EAM, from its feed. */
  assetStatus?: 'active' | 'retired';
  createdBy: string;
  createdAt: number;
}
export interface SurveyDocument {
  id: string;
  title: string;
  kind: 'schematic' | 'plan' | 'datasheet' | 'manual' | 'other';
  file: BlobRef;
  pages?: number;
  nodeId?: string;
  addedBy: string;
  addedAt: number;
}
export interface Assignment {
  id: string;
  title: string;
  roots: string[];
  kinds: CaptureKind[];
  note?: string;
  /** Stored progress; `in-field`, `processed` and `filed` are derived (`assignmentStage`). */
  status: 'draft' | 'dispatched' | 'returned';
  deviceId?: string;
  createdBy: string;
  createdAt: number;
  dispatchedAt?: number;
  returnedAt?: number;
}
export interface Capture {
  id: string;
  assignmentId: string;
  nodeId?: string;
  kind: CaptureKind;
  photos: BlobRef[];
  codes: string[];
  condition?: 'good' | 'fair' | 'poor' | 'failed';
  note: string;
  takenAt: number;
  /** The paired device that delivered it (`device:<id>` principal without the prefix). */
  deviceId: string;
  receivedAt: number;
  review: 'new' | 'reviewed' | 'discarded';
  discardReason?: string;
}
export interface ProposedField {
  name: string;
  value: string;
  confidence: number;
  source: {
    digest: string;
    page?: number;
    region?: { x: number; y: number; width: number; height: number };
  };
}
export interface Extraction {
  captureId: string;
  /** The open request; a proposal for another effect is stale and ignored. */
  effectId: string;
  status: 'requested' | 'proposed' | 'accepted' | 'failed';
  model?: string;
  fields: ProposedField[];
  accepted?: Record<string, string>;
  acceptedBy?: string;
  rejection?: Rejection;
}
export interface Filing {
  id: string;
  nodeId: string;
  designation: string;
  assetId?: string;
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
  assignments: Record<string, Assignment>;
  captures: Record<string, Capture>;
  /** By capture ID: at most one extraction per capture. */
  extractions: Record<string, Extraction>;
  filings: Record<string, Filing>;
  cursors: { model: Cursor; eam: Cursor };
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
    assignments: {},
    captures: {},
    extractions: {},
    filings: {},
    cursors: { model: {}, eam: {} },
  };
}

export const roleOf = (state: SurveyState, principalId: string) => own(state.members, principalId);

/** Field devices act as `device:<id>`; the device-link plugin authenticates them. */
export const DEVICE_PREFIX = 'device:';
export const deviceIdOf = (principalId: string) =>
  principalId.startsWith(DEVICE_PREFIX) ? principalId.slice(DEVICE_PREFIX.length) : undefined;

/** Active children of a node, in designation order. */
export function childrenOf(state: SurveyState, parentId: string | undefined) {
  return Object.values(state.nodes)
    .filter((node) => node.parentId === parentId && !node.retired)
    .sort((a, b) => a.designation.localeCompare(b.designation));
}

/** The node and every active node below it, depth first. Proposed nodes are left out. */
export function subtree(state: SurveyState, rootId: string): SurveyNode[] {
  const root = own(state.nodes, rootId);
  if (!root || root.retired || root.source === 'proposed') return [];
  return [
    root,
    ...childrenOf(state, rootId)
      .filter((child) => child.source !== 'proposed')
      .flatMap((child) => subtree(state, child.id)),
  ];
}

/** Whether `nodeId` lies in one of the assignment's subtrees. */
export const inScope = (state: SurveyState, assignment: Assignment, nodeId: string) =>
  assignment.roots.some((root) => subtree(state, root).some((node) => node.id === nodeId));

export const capturesOf = (state: SurveyState, assignmentId: string) =>
  Object.values(state.captures).filter((capture) => capture.assignmentId === assignmentId);

/**
 * Where an assignment stands. Stored progress (draft, dispatched, returned) is refined by its
 * captures: in the field once one arrives, processed once every capture is reviewed or
 * discarded, filed once every node it covers that has attributes has an accepted filing.
 */
export function assignmentStage(state: SurveyState, assignment: Assignment) {
  const captures = capturesOf(state, assignment.id);
  if (assignment.status === 'draft') return 'draft' as const;
  if (assignment.status === 'dispatched')
    return captures.length ? ('in-field' as const) : ('dispatched' as const);
  if (!captures.length || captures.some((capture) => capture.review === 'new'))
    return 'returned' as const;
  const nodes = assignment.roots
    .flatMap((root) => subtree(state, root))
    .filter((node) => Object.keys(node.attributes).length > 0);
  const filed = nodes.every((node) =>
    Object.values(state.filings).some(
      (filing) => filing.nodeId === node.id && filing.sync === 'accepted',
    ),
  );
  return nodes.length > 0 && filed ? ('filed' as const) : ('processed' as const);
}
