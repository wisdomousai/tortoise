import type { HandlerContribution } from '@agent-native/runtime';
import { operations } from '../contracts';
import type { AppState } from '../domain';
import { handler, type Services } from './context';

/** The attendants, as people who can take a cycle count; viewers only read counts. */
export function assigneeHandlers(): HandlerContribution<AppState, Services>[] {
  return [
    handler(operations.assigneeList, (_input, ctx) => ({
      items: Object.entries(ctx.state.members)
        .filter(([, role]) => role === 'attendant')
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([id]) => ({ type: 'person' as const, id, label: id })),
    })),
  ];
}
