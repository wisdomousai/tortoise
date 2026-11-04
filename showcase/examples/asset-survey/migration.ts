import type { StateMigrations } from '@tortoise/runtime';
import type { AssignmentSlice, StoredAssignment, StoredReport } from '@tortoise/assignments/server';
import {
  surveyInstructions,
  type CaptureKind,
  type ProposedField,
  type SurveyNode,
} from './domain';

/**
 * Version 1 kept field work, captures and extractions in the application's own records. Version
 * 2 keeps them in the `assignment` feature's slice: an assignment becomes a survey, a capture
 * a survey report with the same ID, and an extraction an extraction assignment with the
 * model's reading as its report. Resources keep their IDs where the type stays (`assignment`);
 * the photos of a capture stay attached to `capture:<id>`, which members may still read.
 */
interface V1Assignment {
  id: string;
  title: string;
  roots: string[];
  kinds: CaptureKind[];
  note?: string;
  status: 'draft' | 'dispatched' | 'returned';
  deviceId?: string;
  createdBy: string;
  createdAt: number;
  dispatchedAt?: number;
  returnedAt?: number;
}
interface V1Capture {
  id: string;
  assignmentId: string;
  nodeId?: string;
  kind: CaptureKind;
  photos: unknown[];
  codes: string[];
  condition?: string;
  note: string;
  takenAt: number;
  deviceId: string;
  receivedAt: number;
  review: 'new' | 'reviewed' | 'discarded';
  discardReason?: string;
}
interface V1Extraction {
  captureId: string;
  effectId: string;
  status: 'requested' | 'proposed' | 'accepted' | 'failed';
  model?: string;
  fields: ProposedField[];
  accepted?: Record<string, string>;
  acceptedBy?: string;
  rejection?: { code: string; message: string };
}
interface V1State {
  integrationPrincipalId?: string;
  nodes?: Record<string, SurveyNode & { source?: string; documentId?: string }>;
  assignments?: Record<string, V1Assignment>;
  captures?: Record<string, V1Capture>;
  extractions?: Record<string, V1Extraction>;
  cursors?: Record<string, unknown>;
}

const compact = <T extends object>(value: T): T =>
  Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T;

/** Version 1's field work as the assignment feature's slice. */
export function adoptAssignments(stored: unknown, localUserId: string): AssignmentSlice {
  const v1 = (stored ?? {}) as V1State;
  const nodes = v1.nodes ?? {};
  const integration = v1.integrationPrincipalId ?? 'integration';
  const assignments: Record<string, StoredAssignment> = {};
  const reports: Record<string, StoredReport> = {};
  for (const old of Object.values(v1.assignments ?? {})) {
    const scope = { roots: old.roots, kinds: old.kinds };
    assignments[old.id] = compact({
      id: old.id,
      kind: 'survey',
      title: old.title,
      note: old.note,
      scope,
      instructions: old.status === 'draft' ? undefined : surveyInstructions(nodes, scope),
      assignee: old.deviceId ? { type: 'device' as const, id: old.deviceId } : undefined,
      status: old.status === 'draft' ? 'draft' : old.status === 'dispatched' ? 'sent' : 'done',
      createdBy: old.createdBy,
      createdAt: old.createdAt,
      sentAt: old.dispatchedAt,
      doneBy: old.status === 'returned' && old.deviceId ? `device:${old.deviceId}` : undefined,
      doneAt: old.returnedAt,
    });
  }
  for (const capture of Object.values(v1.captures ?? {})) {
    const extraction = v1.extractions?.[capture.id];
    const reviewed = capture.review === 'reviewed';
    reports[capture.id] = compact({
      id: capture.id,
      assignmentId: capture.assignmentId,
      kind: 'survey',
      subject: capture.nodeId,
      body: compact({
        kind: capture.kind,
        photos: capture.photos,
        codes: capture.codes,
        condition: capture.condition,
        note: capture.note,
        takenAt: capture.takenAt,
      }),
      reportedBy: `device:${capture.deviceId}`,
      reportedAt: capture.receivedAt,
      review: reviewed ? 'accepted' : capture.review,
      reviewedBy: reviewed ? extraction?.acceptedBy : undefined,
      reason: capture.discardReason,
      accepted: reviewed && extraction?.accepted ? { values: extraction.accepted } : undefined,
    }) as StoredReport;
    if (!extraction || extraction.status === 'requested') continue;
    // The model's reading: an assignment to the model, reported by the integration principal.
    const id = `extraction-${capture.id}`;
    const responded = extraction.status !== 'failed';
    assignments[id] = compact({
      id,
      kind: 'extraction',
      title: `Read ${capture.kind} ${capture.id}`,
      scope: { reportId: capture.id },
      instructions: { reportId: capture.id, kind: capture.kind, photos: capture.photos },
      assignee: { type: 'target' as const, id: 'model' },
      status: !responded ? 'sent' : extraction.status === 'accepted' ? 'closed' : 'done',
      createdBy: localUserId,
      createdAt: capture.receivedAt,
      sentAt: capture.receivedAt,
      doneBy: responded ? integration : undefined,
      doneAt: responded ? capture.receivedAt : undefined,
      closedBy: extraction.status === 'accepted' ? extraction.acceptedBy : undefined,
      closedAt: extraction.status === 'accepted' ? capture.receivedAt : undefined,
      effectId: extraction.effectId,
      delivery: responded ? 'accepted' : 'rejected',
      rejection: extraction.rejection,
    }) as StoredAssignment;
    if (responded)
      reports[`${id}-1`] = compact({
        id: `${id}-1`,
        assignmentId: id,
        kind: 'extraction',
        body: { model: extraction.model ?? 'unknown', fields: extraction.fields },
        reportedBy: integration,
        reportedAt: capture.receivedAt,
        review: extraction.status === 'accepted' ? 'accepted' : 'new',
        reviewedBy: extraction.acceptedBy,
        accepted: extraction.accepted ? { values: extraction.accepted } : undefined,
      }) as StoredReport;
  }
  return { assignments, reports, targets: {} };
}

/**
 * Version 2: field work moved into the assignment feature, which adopts it first
 * (`adoptAssignments`); node proposals became approval requests. The step is not compatible,
 * so code from version 1 refuses a version 2 workspace.
 */
export const migrations: StateMigrations = {
  version: 2,
  steps: [
    {
      from: 1,
      to: 2,
      up: (stored) => {
        const v1 = stored as V1State & Record<string, unknown>;
        const proposed = Object.values(v1.nodes ?? {}).filter((node) => node.source === 'proposed');
        const waiting = Object.values(v1.extractions ?? {}).filter(
          (extraction) => extraction.status === 'requested',
        );
        if (proposed.length || waiting.length)
          throw new Error(
            `Resolve ${proposed.length} proposed node(s) and ${waiting.length} extraction(s) waiting for the model with the previous version first`,
          );
        const { assignments: _a, captures: _c, extractions: _e, cursors, nodes, ...rest } = v1;
        const { model: _model, ...kept } = (cursors ?? {}) as Record<string, unknown>;
        return {
          ...rest,
          cursors: { eam: {}, ...kept },
          nodes: Object.fromEntries(
            Object.entries(nodes ?? {}).map(([id, { source: _s, documentId: _d, ...node }]) => [
              id,
              node,
            ]),
          ),
        };
      },
    },
  ],
};
