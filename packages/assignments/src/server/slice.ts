import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';
import { canonicalJson, isBlobRef, type BlobRef } from '@tortoise/contracts';
import type { TargetCursor } from '@tortoise/integration';
import type {
  Assignee,
  AssignmentStage,
  AssignmentStatus,
  ReviewState,
  StoredBody,
} from '../schemas';

/** One assignment as the feature stores it; `present` adds the stage and the report counts. */
export interface StoredAssignment {
  readonly id: string;
  readonly kind: string;
  title: string;
  note?: string;
  scope: StoredBody;
  /** Computed from the scope when it is sent. */
  instructions?: StoredBody;
  assignee?: Assignee;
  status: AssignmentStatus;
  readonly createdBy: string;
  readonly createdAt: number;
  sentAt?: number;
  doneBy?: string;
  doneAt?: number;
  closedBy?: string;
  closedAt?: number;
  reason?: string;
  /** Assignment target only: the offer effect and the target's result. */
  effectId?: string;
  delivery?: 'pending' | 'accepted' | 'rejected';
  rejection?: { code: string; message: string };
}

export interface StoredReport {
  readonly id: string;
  readonly assignmentId: string;
  readonly kind: string;
  subject?: string;
  readonly body: StoredBody;
  readonly reportedBy: string;
  readonly runId?: string;
  readonly reportedAt: number;
  review: ReviewState;
  reviewedBy?: string;
  reviewedAt?: number;
  reason?: string;
  accepted?: StoredBody;
}

/** The feature's state slice, under `assignment` in the application's state. */
export interface AssignmentSlice {
  readonly assignments: Record<string, StoredAssignment>;
  readonly reports: Record<string, StoredReport>;
  /** Each assignment target's inbound watermark, by target name. */
  readonly targets: Record<string, TargetCursor>;
}

export const createSlice = (): AssignmentSlice => ({ assignments: {}, reports: {}, targets: {} });

export const assignmentResource = (id: string) => `assignment:${id}`;
export const reportResource = (id: string) => `assignment-report:${id}`;

/** How many reports each assignment has, and how many of them are not yet reviewed. */
export function reportCounts(slice: AssignmentSlice) {
  const counts = new Map<string, { reports: number; unreviewed: number }>();
  for (const report of Object.values(slice.reports)) {
    const count = counts.get(report.assignmentId) ?? { reports: 0, unreviewed: 0 };
    count.reports++;
    if (report.review === 'new') count.unreviewed++;
    counts.set(report.assignmentId, count);
  }
  return counts;
}

export function stageOf(
  status: AssignmentStatus,
  count: { readonly reports: number; readonly unreviewed: number },
): AssignmentStage {
  if (status === 'sent') return count.reports ? 'working' : 'sent';
  if (status === 'done') return count.unreviewed ? 'done' : 'reviewed';
  return status;
}

const compact = <T extends object>(value: T): T =>
  Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T;

/** An assignment as callers see it, with its stage and report counts. */
export function present(
  assignment: StoredAssignment,
  counts: ReturnType<typeof reportCounts>,
): Record<string, unknown> {
  const count = counts.get(assignment.id) ?? { reports: 0, unreviewed: 0 };
  const { effectId: _effect, ...shown } = assignment;
  return compact({ ...shown, stage: stageOf(assignment.status, count), ...count });
}
export const presentReport = (report: StoredReport): Record<string, unknown> =>
  compact({ ...report });

/** The blobs instructions or a report body references: its top-level blob and blob-list values. */
export function blobRefsOf(body: StoredBody): BlobRef[] {
  return Object.values(body).flatMap((value) =>
    isBlobRef(value)
      ? [value]
      : Array.isArray(value)
        ? (value as unknown[]).filter((item): item is BlobRef => isBlobRef(item))
        : [],
  );
}

/** A digest of inbound sync's items: unchanged items give an unchanged cursor. */
export const inboundCursor = (items: unknown): string =>
  bytesToHex(sha256(utf8ToBytes(canonicalJson(items)))).slice(0, 32);
