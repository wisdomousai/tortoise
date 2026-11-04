import { describe, expect, test } from 'bun:test';
import { buildCatalog, definePeerApi } from '@tortoise/contracts';
import { defineAssignmentKind, defineAssignments, defineWorklist, offerEventType } from '../src';
import { assignments, checker, issuerApi, notesModule, review, survey } from './fixture';

const photo = { digest: `sha256:${'a'.repeat(64)}`, size: 10, mediaType: 'image/jpeg' };
const destination = {
  id: 'hub',
  purpose: 'Reach the issuer.',
  dataClasses: ['report'],
  availability: 'optional',
  offline: 'queue',
} as const;

describe('defineAssignments', () => {
  test('generates each kind’s commands, the generic operations and the assignment target', () => {
    const ids = buildCatalog([notesModule, assignments.module], {
      components: [checker],
    }).operations.map((operation) => operation.id);
    expect(ids).toEqual(
      expect.arrayContaining([
        'assignment.review.create',
        'assignment.review.send',
        'assignment.review.report',
        'assignment.review.accept',
        'assignment.field-survey.create',
        'assignment.field-survey.report',
        'assignment.withdraw',
        'assignment.complete',
        'assignment.close',
        'assignment.list',
        'assignment.get',
        'assignment.feed',
        'assignment.report.list',
        'assignment.report.get',
        'assignment.report.link',
        'assignment.report.discard',
        'assignment.checker.complete',
        'assignment.checker.sync',
        'assignment.checker.status',
      ]),
    );
    expect(ids).toHaveLength(1 + 4 * 2 + 10 + 3);
    expect(assignments.manifest.id).toBe('assignment');
    expect(Object.keys(assignments.targets)).toEqual(['checker']);
  });

  test('keys the operations for screens and declares each kind’s target, blobs and invokes', () => {
    const { operations } = assignments;
    expect(operations.reviewCreate.id).toBe('assignment.review.create');
    expect(operations.fieldSurveyReport.id).toBe('assignment.field-survey.report');
    expect(operations.reviewCreate.integration).toEqual({
      target: 'assignment-checker',
      delivery: 'outbox',
    });
    expect(operations.fieldSurveyCreate.integration).toBeUndefined();
    expect(operations.fieldSurveyReport.blobs).toEqual(survey.blobs!.report!);
    expect(operations.reviewReport.blobs).toBeUndefined();
    expect(operations.reviewAccept.invokes).toEqual(['notes.note.update']);
    expect(operations.reviewAccept.dependencies).toContain('note');
    expect(operations.reportLink?.id).toBe('assignment.report.link');
    const created: 'assignment.review.create' = operations.reviewCreate.id;
    expect(created).toBe('assignment.review.create');
    // @ts-expect-error a kind the declaration does not have
    expect(operations.surveyCreate).toBeUndefined();
  });

  test('refuses an assignment target without a destination and repeated kinds', () => {
    expect(() => buildCatalog([notesModule, assignments.module])).toThrow('assignment-checker');
    expect(() => defineAssignments({ kinds: [review, review] })).toThrow('repeat');
    expect(() => defineAssignments({ kinds: [] })).toThrow('at least one kind');
  });

  test('omits linking reports when no kind has a subject', () => {
    const plain = defineAssignmentKind({ ...survey, id: 'plain', subject: undefined });
    expect(defineAssignments({ kinds: [plain] }).operations.reportLink).toBeUndefined();
  });

  test('validates per-kind input and the generic reads across kinds', () => {
    const { operations } = assignments;
    expect(() =>
      operations.reviewCreate.input.parse({ title: 'Week 3', scope: { roots: ['n1'] } }),
    ).toThrow();
    expect(
      operations.fieldSurveyReport.input.parse({
        id: 'r1',
        assignmentId: 'a1',
        subject: 'n1',
        body: { photos: [photo], condition: 'good' },
      }),
    ).toMatchObject({ subject: 'n1' });
    const sent = { id: 'a1', title: 'Week 3', sentAt: 1 };
    expect(
      operations.feed.output.parse({
        items: [
          { ...sent, kind: 'review', brief: { notes: [{ id: 'n1', title: 'T', body: 'B' }] } },
          { ...sent, id: 'a2', kind: 'field-survey', brief: { nodes: [] } },
        ],
        cursor: 'c',
      }).items,
    ).toHaveLength(2);
    expect(() =>
      operations.feed.output.parse({ items: [{ ...sent, kind: 'other', brief: {} }], cursor: 'c' }),
    ).toThrow();
  });

  test('gives a device and a peer the report commands of their kinds, completion and the feed', () => {
    expect(assignments.assignees.device.operations).toEqual([
      'assignment.field-survey.report',
      'assignment.complete',
      'assignment.feed',
    ]);
    expect(assignments.assignees.peer.operations).toEqual(assignments.assignees.device.operations);
  });

  test('names the event type of an offer to an agent', () => {
    expect(offerEventType('note-reviewer')).toBe('offer.note-reviewer');
  });
});

describe('defineWorklist', () => {
  const worklist = defineWorklist({
    namespace: 'field',
    target: 'hub',
    assignments,
    issuer: issuerApi,
    assigneeType: 'device',
    destination,
  });

  test('declares the assignee’s operations and a target fed by the issuer’s feed', () => {
    const ids = buildCatalog([worklist.module], {
      components: [worklist.target.component],
    }).operations.map((operation) => operation.id);
    expect(ids.sort()).toEqual([
      'field.assignment.complete',
      'field.assignment.get',
      'field.assignment.list',
      'field.field-survey.report',
      'field.hub.complete',
      'field.hub.status',
      'field.hub.sync',
      'field.report.list',
    ]);
    expect(worklist.target.feedQuery).toBe('assignment.feed');
    expect(worklist.operations.fieldSurveyReport.integration?.target).toBe('hub');
    expect(worklist.operations.fieldSurveyReport.blobs).toEqual(survey.blobs!.report!);
    expect(worklist.types).toEqual({ assignment: 'field-assignment', report: 'field-report' });
  });

  test('takes only the kinds of its assignee type and refuses an API that lacks an assignee operation', () => {
    expect(worklist.kinds.map((kind) => kind.id)).toEqual(['field-survey']);
    const partial = definePeerApi({
      application: 'issuer',
      queries: assignments.assignees.peer.queries,
    });
    expect(() =>
      defineWorklist({
        namespace: 'field',
        target: 'hub',
        assignments,
        issuer: partial,
        assigneeType: 'peer',
        destination,
      }),
    ).toThrow('does not list assignment.field-survey.report');
    const personal = defineAssignments({
      kinds: [defineAssignmentKind({ ...review, assigneeTypes: ['person'], target: undefined })],
    });
    expect(() =>
      defineWorklist({
        namespace: 'field',
        target: 'hub',
        assignments: personal,
        issuer: issuerApi,
        assigneeType: 'peer',
        destination,
      }),
    ).toThrow('No assignment kind takes the peer assignee type');
  });

  test('records reports whose bodies the kind’s schema checks', () => {
    const input = { assignmentId: 'a1', body: { photos: [photo] } };
    expect(worklist.operations.fieldSurveyReport.input.parse(input)).toEqual(input);
    expect(() =>
      worklist.operations.fieldSurveyReport.input.parse({ ...input, body: { photos: 'x' } }),
    ).toThrow();
  });
});
