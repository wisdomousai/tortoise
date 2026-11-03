import { ApplicationError } from '@agent-native/contracts';
import { DEFAULT_PAGE, type HandlerContribution } from '@agent-native/runtime';
import { operations } from '../contracts';
import type { AppState } from '../domain';
import { handler, type Services } from './context';
import { transformerBySerial } from './transformer';

/**
 * Search parts by transformer, category and text. Members. Every member sees every part; the
 * serial, category and text filter the parts before they are counted and paged, so `total` and
 * the page boundaries count matching parts only.
 */
export function partSearchHandlers(): HandlerContribution<AppState, Services>[] {
  return [
    // #region handler
    handler(operations.partSearch, (input, ctx) => {
      let model: string | undefined;
      if (input.transformerSerial !== undefined) {
        const transformer = transformerBySerial(ctx.state, input.transformerSerial);
        if (!transformer)
          throw new ApplicationError('NOT_FOUND', 'Transformer unavailable', {
            field: 'transformerSerial',
          });
        model = transformer.model;
      }
      const text = input.text?.trim().toLowerCase();
      const matches = Object.values(ctx.state.parts)
        .filter((part) => model === undefined || part.fits.includes(model))
        .filter((part) => input.category === undefined || part.category === input.category)
        .filter(
          (part) => !text || `${part.partNumber} ${part.description}`.toLowerCase().includes(text),
        )
        .sort((a, b) => (a.partNumber < b.partNumber ? -1 : a.partNumber > b.partNumber ? 1 : 0));
      const offset = input.offset ?? 0;
      return {
        items: matches.slice(offset, offset + (input.limit ?? DEFAULT_PAGE)),
        total: matches.length,
      };
    }),
    // #endregion handler
  ];
}
