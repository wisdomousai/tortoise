import { randomUUID } from 'node:crypto';
import type { AnyCapability, InputOf, OutputOf } from '@agent-native/contracts';
import type { HandlerContext, HandlerContribution } from '@agent-native/runtime';
import type { LineState } from '../domain';

export interface LineServices {
  newId?: () => string;
  /** Authority clock for freshness, stops and confirmations. */
  now?: () => number;
}
export type Context = HandlerContext<LineState, LineServices>;

export const byCodePoint = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
/** JSON state and DTOs never hold `undefined`; optional members are omitted. */
export function compact<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T;
}
export const now = (ctx: Context) => (ctx.services.now ?? Date.now)();
export const newId = (ctx: Context) => (ctx.services.newId ?? randomUUID)();
/** Pair a capability with its handler, keeping the capability's input and output types. */
export function handler<C extends AnyCapability>(
  capability: C,
  handle: (input: InputOf<C>, context: Context) => OutputOf<C> | Promise<OutputOf<C>>,
): HandlerContribution<LineState, LineServices, C> {
  return { capability, handle };
}
