import type { BlobRef } from '@agent-native/contracts';
import { own } from '@agent-native/runtime';
import type { CaptureKind } from '@agent-native/asset-survey/domain';
import type { SchemeId } from '@agent-native/asset-survey/contracts/schemes';

/**
 * The field device's workspace. The hub owns assignments and their structure; the device keeps
 * the copy its feed last delivered and never edits it. The device owns its captures until the
 * hub has taken them, and keeps them afterwards to show what was sent.
 */
export type HubSync = 'pending' | 'accepted' | 'rejected';
export interface Rejection {
  code: string;
  message: string;
}

export interface FieldNode {
  id: string;
  parentId?: string;
  scheme: SchemeId;
  designation: string;
  name: string;
}
export interface FieldAssignment {
  id: string;
  title: string;
  kinds: CaptureKind[];
  note?: string;
  nodes: FieldNode[];
  /** The hub has the return, from this device or from a manager. */
  returned: boolean;
}
export interface FieldCapture {
  id: string;
  assignmentId: string;
  nodeId?: string;
  kind: CaptureKind;
  photos: BlobRef[];
  codes: string[];
  condition?: 'good' | 'fair' | 'poor' | 'failed';
  note: string;
  takenAt: number;
  effectId: string;
  sync: HubSync;
  rejection?: Rejection;
}
/** A return this device sent; the assignment takes no more captures from then on. */
export interface FieldReturn {
  effectId: string;
  sync: HubSync;
  rejection?: Rejection;
}
export interface FieldState {
  ownerId: string;
  integrationPrincipalId: string;
  assignments: Record<string, FieldAssignment>;
  captures: Record<string, FieldCapture>;
  returns: Record<string, FieldReturn>;
  cursor: { watermark?: string; lastSyncAt?: number };
}

export const createFieldState = (ownerId: string, integrationPrincipalId: string): FieldState => ({
  ownerId,
  integrationPrincipalId,
  assignments: {},
  captures: {},
  returns: {},
  cursor: {},
});

/** Closed for capture: returned here or at the hub. */
export const isClosed = (state: FieldState, assignment: FieldAssignment) =>
  assignment.returned || own(state.returns, assignment.id) !== undefined;

const compactKey = (text: string) => text.replace(/\s+/g, '').toUpperCase();

/** The assignment's nodes depth first, each with its depth, as the hub sent them. */
export function slice(assignment: FieldAssignment) {
  const children = new Map<string | undefined, FieldNode[]>();
  for (const node of assignment.nodes) {
    const key = node.parentId;
    children.set(key, [...(children.get(key) ?? []), node]);
  }
  const walk = (node: FieldNode, depth: number): (FieldNode & { depth: number })[] => [
    { ...node, depth },
    ...(children.get(node.id) ?? [])
      .sort((a, b) => a.designation.localeCompare(b.designation))
      .flatMap((child) => walk(child, depth + 1)),
  ];
  return (children.get(undefined) ?? [])
    .sort((a, b) => a.designation.localeCompare(b.designation))
    .flatMap((root) => walk(root, 0));
}

/** Nodes whose designation starts with `q` (spaces and case ignored) or whose name contains it. */
export function matches(node: FieldNode, q: string) {
  const key = compactKey(q);
  const text = q.trim().toLowerCase();
  return (
    !text || compactKey(node.designation).startsWith(key) || node.name.toLowerCase().includes(text)
  );
}
