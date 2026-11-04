import {
  collectionCommandHandlers,
  collectionGetHandler,
  collectionListHandler,
  type HandlerContribution,
} from '@tortoise/runtime';
import { operations } from '../contracts';
import { parts, type Part } from '../contracts/part';
import type { AppState } from '../domain';
import { assertUnique, newId, now, type Services } from './context';

type List = typeof operations.partList;
type Get = typeof operations.partGet;
/** Every member sees every part; the policy's caller gate keeps everyone else out. */
const visible = () => true;
const store = (state: AppState) => state.parts;

/** Generated reads, scoped before filters and counts, and the generated commands. */
export function partHandlers(): HandlerContribution<AppState, Services>[] {
  return [
    collectionListHandler<AppState, Services, List, Part>(parts, operations.partList, {
      store,
      visible,
      order: (a, b) => b.createdAt - a.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
      searchText: (record) => `${record.partNumber} ${record.description}`,
    }),
    collectionGetHandler<AppState, Services, Get, Part>(parts, operations.partGet, {
      store,
      visible,
    }),
    ...collectionCommandHandlers<AppState, Services, Part>(
      parts,
      {
        create: operations.partCreate,
        update: operations.partUpdate,
      },
      {
        store,
        newKey: newId,
        // The fields a person does not choose: who added the part and when.
        defaults: (ctx) => ({ createdBy: ctx.context.principalId, createdAt: now(ctx) }),
        // A model listed twice fits once.
        normalize: (record) => ({ ...record, fits: [...new Set(record.fits)] }),
        validate: (record, ctx) =>
          assertUnique(store(ctx.state), record, 'partNumber', 'Part number'),
      },
    ),
  ];
}
