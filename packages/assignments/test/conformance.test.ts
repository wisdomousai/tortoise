import { describe, test } from 'bun:test';
import { featureConformance } from '@tortoise/testing/features';
import { assignmentFeature, type AssignmentAccess, type AssignmentSlice } from '../src/server';
import { assignments } from './fixture';

const assignment = {
  id: 'a1',
  kind: 'review',
  title: 'Week 3',
  scope: { notes: ['n1'] },
  instructions: { notes: [{ id: 'n1', title: 'Pumps', body: 'Check the seals.' }] },
  assignee: { type: 'person' as const, id: 'person' },
  status: 'sent' as const,
  createdBy: 'pat',
  createdAt: 1,
  sentAt: 2,
};
const report = {
  id: 'r1',
  assignmentId: 'a1',
  kind: 'review',
  subject: 'n1',
  body: { verdict: 'keep', comment: 'Fine.' },
  reportedBy: 'person',
  reportedAt: 3,
  review: 'new' as const,
};
const sampleSlice: AssignmentSlice = {
  assignments: {
    a1: assignment,
    a2: { ...assignment, id: 'a2', status: 'draft', assignee: undefined } as never,
  },
  reports: { r1: report },
  targets: {},
};
const allowAll: AssignmentAccess = { allows: () => true };
const denyAll: AssignmentAccess = { allows: () => false };
const event = (resource: string) => ({
  cursor: 1,
  resource,
  revision: 1,
  type: 'changed',
  operation: 'assignment.review.create',
});

describe('assignment feature conformance', () => {
  for (const conformance of featureConformance(assignmentFeature(assignments), {
    allowAll,
    denyAll,
    sampleSlice,
    requests: [
      { operation: 'assignment.review.create', input: { title: 'T', scope: { notes: ['n1'] } } },
      {
        operation: 'assignment.review.send',
        input: { id: 'a2', assignee: { type: 'person', id: 'wes' } },
      },
      {
        operation: 'assignment.review.report',
        input: { id: 'r2', assignmentId: 'a1', body: { verdict: 'keep', comment: '' } },
      },
      { operation: 'assignment.review.accept', input: { id: 'r1' } },
      { operation: 'assignment.withdraw', input: { id: 'a1' } },
      { operation: 'assignment.complete', input: { id: 'a1' } },
      { operation: 'assignment.close', input: { id: 'a1' } },
      { operation: 'assignment.list', input: {} },
      { operation: 'assignment.get', input: { id: 'a1' } },
      { operation: 'assignment.inbound', input: {} },
      { operation: 'assignment.report.list', input: {} },
      { operation: 'assignment.report.get', input: { id: 'r1' } },
      { operation: 'assignment.report.link', input: { id: 'r1', subject: 'n1' } },
      { operation: 'assignment.report.discard', input: { id: 'r1' } },
    ],
    events: [event('assignment:a1'), event('assignment-report:r1')],
    personOnly: ['assignment.review.accept', 'assignment.field-survey.accept'],
  }))
    test(conformance.name, async () => {
      await conformance.run();
    });
});
