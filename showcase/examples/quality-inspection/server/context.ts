import { randomUUID } from 'node:crypto';
import {
  ApplicationError,
  type AnyCapability,
  type InputOf,
  type OutputOf,
} from '@agent-native/contracts';
import type { HandlerContext, HandlerContribution } from '@agent-native/runtime';
import { qualityTarget } from '../contracts/target';
import { own, type InspectionLot, type QualityState } from '../domain';

export interface QualityServices {
  newId?: () => string;
  /** Instance clock for recordedAt and occurredAt skew checks. */
  now?: () => number;
}
export type Context = HandlerContext<QualityState, QualityServices>;
export type Measurement = {
  characteristicId: string;
  sample?: number;
  value?: number;
  code?: string;
  occurredAt: number;
  capture?: { durationMs: number; input: 'keyboard' | 'scanner' | 'instrument' | 'touch' };
};

/** Outbox target of every forwarded result, defect and usage decision. */
export const TARGET = qualityTarget.target;
/** Paper backlogs are entered later the same shift; anything older needs the SoR's own process. */
export const MAX_AGE_MS = 24 * 3_600_000;
export const MAX_CLOCK_SKEW_MS = 5 * 60_000;
/** Defect codes are published by the SoR in this code group. */
export const DEFECT_CODE_GROUP = 'defects';

/** Locale-independent ordering keeps results identical on every host. */
export const byCodePoint = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
/** JSON state and DTOs never hold `undefined`; optional members are omitted. */
export function compact<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T;
}
export function invalid(field: string, message: string): never {
  // `field` lets form bindings attach the message to the input that caused it.
  throw new ApplicationError('INVALID_INPUT', message, { field });
}
export function lotOf(state: QualityState, id: string): InspectionLot {
  const lot = own(state.lots, id);
  if (!lot) throw new ApplicationError('NOT_FOUND', 'Inspection lot unavailable');
  return lot;
}
export function requireOpen(lot: InspectionLot): void {
  if (lot.status !== 'open')
    throw new ApplicationError('CONFLICT', `Inspection lot is ${lot.status}`, {
      status: lot.status,
    });
}
export const now = (ctx: Context) => (ctx.services.now ?? Date.now)();
export const newId = (ctx: Context) => (ctx.services.newId ?? randomUUID)();

export function handler<C extends AnyCapability>(
  capability: C,
  handle: (input: InputOf<C>, context: Context) => OutputOf<C> | Promise<OutputOf<C>>,
): HandlerContribution<QualityState, QualityServices, C> {
  return { capability, handle };
}
