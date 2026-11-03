import { ApplicationError } from '@agent-native/contracts';
import {
  collectionCommandHandlers,
  collectionGetHandler,
  collectionListHandler,
  type HandlerContribution,
} from '@agent-native/runtime';
import { operations } from '../contracts';
import { tools, type Tool } from '../contracts/tool';
import type { AppState } from '../domain';
import { newId, now, type Services } from './context';

type List = typeof operations.toolList;
type Get = typeof operations.toolGet;
/** Every member sees every tool; the policy's caller gate keeps everyone else out. */
const visible = () => true;
const store = (state: AppState) => state.tools;
/** A tool with its revision, which a screen observes when it shares the tool with agent runs. */
const withRevision = (record: Tool, ctx: { getRevision(resource: string): number }) => ({
  ...record,
  revision: ctx.getRevision(`tool:${record.id}`),
});

/** A real calendar day: `2026-02-30` matches the schema's shape and is refused here. */
function isCalendarDate(value: string) {
  const day = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(day.getTime()) && day.toISOString().startsWith(value);
}

/** Generated reads, scoped before filters and counts, and the generated commands. */
export function toolHandlers(): HandlerContribution<AppState, Services>[] {
  return [
    collectionListHandler<AppState, Services, List, Tool>(tools, operations.toolList, {
      store,
      visible,
      order: (a, b) => b.createdAt - a.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
      searchText: (record) => `${record.assetTag} ${record.description}`,
      // The terminal's Tools tab shares the rows a person ticks with the revision each row shows.
      present: withRevision,
    }),
    collectionGetHandler<AppState, Services, Get, Tool>(tools, operations.toolGet, {
      store,
      visible,
      present: withRevision,
    }),
    ...collectionCommandHandlers<AppState, Services, Tool>(
      tools,
      {
        create: operations.toolCreate,
        update: operations.toolUpdate,
      },
      {
        store,
        newKey: newId,
        // The fields a person does not choose: a new tool is available and records who made it.
        defaults: (ctx) => ({
          status: 'available',
          createdBy: ctx.context.principalId,
          createdAt: now(ctx),
        }),
        // The schema cannot trim, so the stored form is canonical here.
        normalize: (record) => ({
          ...record,
          description: record.description.trim(),
          bin: record.bin.trim(),
        }),
        validate: (record, ctx) => {
          if (record.description === '' || record.bin === '')
            throw new ApplicationError('INVALID_INPUT', 'Description and bin cannot be blank');
          if (record.calibrationDue !== undefined && !isCalendarDate(record.calibrationDue))
            throw new ApplicationError('INVALID_INPUT', 'Calibration due is not a date', {
              field: 'calibrationDue',
            });
          // The tag is etched on one tool: no other record, whatever its status, may hold it.
          const taken = Object.values(store(ctx.state)).some(
            (other) => other.id !== record.id && other.assetTag === record.assetTag,
          );
          if (taken)
            throw new ApplicationError('CONFLICT', 'A tool with this asset tag exists', {
              field: 'assetTag',
            });
        },
      },
    ),
  ];
}
