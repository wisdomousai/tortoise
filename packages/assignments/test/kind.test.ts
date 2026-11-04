import { describe, expect, test } from 'bun:test';
import { z } from 'zod';
import { defineAssignmentKind, type AssignmentKindSpec } from '../src';

const object = z.strictObject({ text: z.string() });
type Spec = AssignmentKindSpec<string, typeof object, typeof object, typeof object, z.ZodObject>;
const base: Spec = {
  id: 'check',
  title: 'Check',
  description: 'Check the text.',
  scope: object,
  instructions: object,
  report: object,
  assigneeTypes: ['person'],
};
const define = (change: Partial<Spec>) => () => defineAssignmentKind({ ...base, ...change });

describe('defineAssignmentKind', () => {
  test('defaults the accept input to an empty object and freezes the kind', () => {
    const kind = defineAssignmentKind(base);
    expect(Object.keys(kind.accept.shape)).toEqual([]);
    expect(Object.isFrozen(kind)).toBe(true);
    expect(kind.accept.parse({})).toEqual({});
  });

  test('refuses an invalid, reserved or overlong ID', () => {
    expect(define({ id: 'Check' })).toThrow('Invalid assignment kind');
    expect(define({ id: 'report' })).toThrow('reserved');
    expect(define({ id: 'inbound' })).toThrow('reserved');
    expect(define({ id: `a${'-b'.repeat(20)}` })).toThrow('Invalid assignment kind');
  });

  test('refuses a missing, unknown or repeated assignee type', () => {
    expect(define({ assigneeTypes: [] })).toThrow('has no assignee type');
    expect(define({ assigneeTypes: ['robot' as 'person'] })).toThrow('unknown assignee type');
    expect(define({ assigneeTypes: ['person', 'person'] })).toThrow('repeats an assignee type');
  });

  test('needs a target name exactly with the target assignee type', () => {
    expect(define({ assigneeTypes: ['target'] })).toThrow('target assignee type without a target');
    expect(define({ target: 'checker' })).toThrow(
      'names a target without the target assignee type',
    );
    expect(define({ assigneeTypes: ['target'], target: 'list' })).toThrow('reserved');
    expect(
      defineAssignmentKind({ ...base, assigneeTypes: ['target'], target: 'checker' }).target,
    ).toBe('checker');
  });

  test('refuses instructions blobs for a device or a peer, whose pull carries no blobs', () => {
    const blobs = { instructions: { maxBytes: 1000, mediaTypes: ['image/png'] } };
    expect(define({ assigneeTypes: ['device'], blobs })).toThrow('instructions blobs');
    expect(define({ assigneeTypes: ['person', 'peer'], blobs })).toThrow('instructions blobs');
    expect(defineAssignmentKind({ ...base, blobs }).blobs).toEqual(blobs);
  });

  test('refuses invalid blob limits, an accept input with an id and a bad subject type', () => {
    expect(define({ blobs: { report: { maxBytes: 0, mediaTypes: ['image/png'] } } })).toThrow(
      'Blob size limit',
    );
    expect(define({ accept: z.strictObject({ id: z.string() }) })).toThrow('accept input');
    expect(define({ subject: 'Node' })).toThrow('invalid subject type');
  });
});
