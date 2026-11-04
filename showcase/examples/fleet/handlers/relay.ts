import { ApplicationError } from '@tortoise/contracts';
import { fleetInstanceOperations } from '@tortoise/fleet-agent/contracts';
import {
  collectionGetHandler,
  collectionListHandler,
  records,
  type HandlerContribution,
} from '@tortoise/runtime';
import { operations } from '../contracts';
import { RELAYS_KEPT, relays, type Relay } from '../contracts/relay';
import { instances } from '../contracts/instances';
import type { AppState, StoredRelay } from '../domain';
import { compact, handler, newId, now, type Context, type Services } from './context';
import { callingInstance } from './instances';

type List = typeof operations.relayList;
type Get = typeof operations.relayGet;
const store = (state: AppState) => state.relays;
const visible = () => true;
/** What a caller sees: never the outgoing headers, which may carry an instance session. */
const present = ({ outgoing: _outgoing, ...relay }: StoredRelay): Relay => relay;
const newest = (a: Relay, b: Relay) => b.requestedAt - a.requestedAt || (a.id < b.id ? 1 : -1);

/** Drop the oldest responded requests beyond the number kept. */
function prune(ctx: Context) {
  const all = Object.values(ctx.state.relays).sort(newest);
  const responded = all.filter((relay) => relay.status === 'responded');
  for (const relay of responded.slice(Math.max(0, RELAYS_KEPT - (all.length - responded.length))))
    records(ctx, relays, ctx.state.relays).remove(relay.id);
}

export function relayHandlers(): HandlerContribution<AppState, Services>[] {
  return [
    collectionListHandler<AppState, Services, List, StoredRelay>(relays, operations.relayList, {
      store,
      visible,
      present,
      order: newest,
    }),
    collectionGetHandler<AppState, Services, Get, StoredRelay>(relays, operations.relayGet, {
      store,
      visible,
      present,
    }),
    handler(operations.relayRequest, (input, ctx) => {
      records(ctx, instances, ctx.state.instances).getExisting(input.instance);
      const id = newId(ctx);
      records(ctx, relays, ctx.state.relays).insert(id, {
        id,
        instance: input.instance,
        method: input.method,
        path: input.path,
        status: 'queued',
        requestedBy: ctx.context.principalId,
        requestedAt: now(ctx),
        outgoing: compact({
          headers: input.headers ?? {},
          body: input.body === undefined ? undefined : Buffer.from(input.body).toString('base64'),
        }),
      });
      return { id };
    }),
    handler(fleetInstanceOperations.relayClaim, (_input, ctx) => {
      const instance = callingInstance(ctx);
      const oldest = Object.values(ctx.state.relays)
        .filter((relay) => relay.instance === instance && relay.status === 'queued')
        .sort((a, b) => a.requestedAt - b.requestedAt || (a.id < b.id ? -1 : 1))[0];
      if (!oldest) return {};
      const { outgoing } = oldest;
      records(ctx, relays, ctx.state.relays).update(oldest.id, (relay) => {
        relay.status = 'claimed';
        delete relay.outgoing;
      });
      return {
        request: compact({
          id: oldest.id,
          method: oldest.method,
          path: oldest.path,
          headers: outgoing?.headers ?? {},
          body: outgoing?.body,
        }),
      };
    }),
    handler(fleetInstanceOperations.relayRespond, (input, ctx) => {
      const relay = records(ctx, relays, ctx.state.relays).getExisting(input.id);
      if (relay.instance !== callingInstance(ctx) || relay.status !== 'claimed')
        throw new ApplicationError('CONFLICT', 'This instance did not take that request');
      records(ctx, relays, ctx.state.relays).update(input.id, (record) =>
        Object.assign(
          record,
          compact({
            status: 'responded' as const,
            respondedAt: now(ctx),
            response: input.status,
            responseHeaders: input.headers,
            responseBody: input.body,
          }),
        ),
      );
      prune(ctx);
      return {};
    }),
  ];
}
