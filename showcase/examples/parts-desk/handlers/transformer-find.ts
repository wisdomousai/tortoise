import { own, type HandlerContribution } from '@agent-native/runtime';
import { operations } from '../contracts';
import { FIND_LIMIT } from '../contracts/transformer-find';
import type { AppState } from '../domain';
import { compact, handler, type Services } from './context';

/**
 * Find transformers by serial, whole or partial. Members. Every member sees every transformer,
 * so the match runs over all of them; `total` counts the matches before the limit, so a caller
 * knows when a partial serial names more transformers than it returned.
 */
export function transformerFindHandlers(): HandlerContribution<AppState, Services>[] {
  return [
    handler(operations.transformerFind, (input, ctx) => {
      const text = input.serial.trim().toUpperCase();
      const matches = Object.values(ctx.state.transformers)
        .filter((record) => record.serial.startsWith(text))
        .sort(
          (a, b) =>
            Number(b.serial === text) - Number(a.serial === text) ||
            (a.serial < b.serial ? -1 : a.serial > b.serial ? 1 : 0),
        );
      return {
        items: matches.slice(0, FIND_LIMIT).map((record) =>
          compact({
            ...record,
            customerName: own(ctx.state.customers, record.customerId)?.name,
          }),
        ),
        total: matches.length,
      };
    }),
  ];
}
