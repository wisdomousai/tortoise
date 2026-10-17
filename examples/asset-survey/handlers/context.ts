import { randomUUID } from 'node:crypto';
import {
  ApplicationError,
  type AnyCapability,
  type JsonValue,
  type InputOf,
  type OutputOf,
} from '@agent-native/contracts';
import { records, type HandlerContext, type HandlerContribution } from '@agent-native/runtime';
import { schemes } from '../contracts/schemes';
import type { SurveyNode, SurveyState } from '../domain';

export interface SurveyServices {
  newId?: () => string;
  /** Authority clock for creation, receipt and filing times. */
  now?: () => number;
}
export type Context = HandlerContext<SurveyState, SurveyServices>;

export const now = (ctx: Context) => (ctx.services.now ?? Date.now)();
export const newId = (ctx: Context) => (ctx.services.newId ?? randomUUID)();

/** JSON state and DTOs never hold `undefined`; optional members are omitted. */
export function compact<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T;
}
export function invalid(field: string, message: string): never {
  throw new ApplicationError('INVALID_INPUT', message, { field });
}
export function conflict(message: string, details?: JsonValue): never {
  throw new ApplicationError('CONFLICT', message, details);
}

const label = (one: string, many: string) => ({ one, many });
export const nodeRecords = (ctx: Context) =>
  records(ctx, { type: 'node', label: label('Node', 'Nodes') }, ctx.state.nodes);
export const documentRecords = (ctx: Context) =>
  records(ctx, { type: 'document', label: label('Document', 'Documents') }, ctx.state.documents);
export const assignmentRecords = (ctx: Context) =>
  records(
    ctx,
    { type: 'assignment', label: label('Assignment', 'Assignments') },
    ctx.state.assignments,
  );
export const captureRecords = (ctx: Context) =>
  records(ctx, { type: 'capture', label: label('Capture', 'Captures') }, ctx.state.captures);
export const extractionRecords = (ctx: Context) =>
  records(
    ctx,
    { type: 'extraction', label: label('Extraction', 'Extractions') },
    ctx.state.extractions,
  );
export const filingRecords = (ctx: Context) =>
  records(ctx, { type: 'filing', label: label('Filing', 'Filings') }, ctx.state.filings);

/** A node as callers see it: no bookkeeping, plus the scheme's label for its designation. */
export function nodeDto(node: SurveyNode) {
  const { createdBy: _by, createdAt: _at, documentId: _document, ...visible } = node;
  return compact({ ...visible, label: schemes[node.scheme].describe(node.designation) });
}

export function handler<C extends AnyCapability>(
  capability: C,
  handle: (input: InputOf<C>, context: Context) => OutputOf<C> | Promise<OutputOf<C>>,
): HandlerContribution<SurveyState, SurveyServices, C> {
  return { capability, handle };
}
