import { randomUUID } from 'node:crypto';
import type { AnyCapability, InputOf, OutputOf } from '@agent-native/contracts';
import type { HandlerContext, HandlerContribution } from '@agent-native/runtime';
import type { AppState } from '../domain';

export interface Services {
  /** Record keys; random UUIDs when omitted. */
  newId?: () => string;
  /** Authority clock for timestamps. */
  now?: () => number;
}
export type Context = HandlerContext<AppState, Services>;

export const now = (ctx: Context) => (ctx.services.now ?? Date.now)();
export const newId = (ctx: Context) => (ctx.services.newId ?? randomUUID)();

/** JSON state never holds `undefined`; optional members are omitted. */
export function compact<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T;
}

/** Bind a handler to its capability with this application's state and services. */
export function handler<C extends AnyCapability>(
  capability: C,
  handle: (input: InputOf<C>, context: Context) => OutputOf<C> | Promise<OutputOf<C>>,
): HandlerContribution<AppState, Services, C> {
  return { capability, handle };
}
