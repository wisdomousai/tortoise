import type { z } from 'zod';
import { ApplicationError, AUDIT_GENESIS } from '@tortoise/contracts';
import { fleetInstanceOperations } from '@tortoise/fleet-agent/contracts';
import { pastBestBefore } from '@tortoise/kernel/build';
import {
  collectionGetHandler,
  collectionListHandler,
  records,
  type HandlerContribution,
} from '@tortoise/runtime';
import { operations } from '../contracts';
import { relays } from '../contracts/relay';
import { channels } from '../contracts/releases';
import { healthSchema, instances, type Instance } from '../contracts/instances';
import { desiredRelease, instanceIdOf, type AppState } from '../domain';
import { compact, handler, now, type Context, type Services } from './context';

type List = typeof operations.instanceList;
type Get = typeof operations.instanceGet;
const store = (state: AppState) => state.instances;
const visible = () => true;
const instancesOf = (ctx: Context) => records(ctx, instances, ctx.state.instances);

/** An instance not heard from for this long is stale. */
export const STALE_MS = 15 * 60_000;
/** Audit forwarding this many events behind the instance's head needs a look. */
const AUDIT_BEHIND = 1000;

/** The calling instance's ID. Only the device allowlist reaches the protocol, so this is a guard. */
export function callingInstance(ctx: Context): string {
  const id = instanceIdOf(ctx.context.principalId);
  if (id === undefined)
    throw new ApplicationError('FORBIDDEN', 'Only an enrolled instance calls the fleet protocol');
  return id;
}

/** The calling instance's record; NOT_FOUND until its first report. */
export function reportedInstance(ctx: Context): Instance {
  return instancesOf(ctx).getExisting(callingInstance(ctx), 'Report before anything else');
}

type Issue = z.output<typeof healthSchema>['issues'][number];

function issues(instance: Instance, state: AppState, at: number): Issue[] {
  const found: Omit<Issue, 'instance'>[] = [];
  if (at - instance.lastSeenAt > STALE_MS)
    found.push({
      kind: 'stale',
      detail: `No report since ${new Date(instance.lastSeenAt).toISOString()}`,
    });
  if (instance.held)
    found.push({ kind: 'held', detail: `${instance.held} effects held for reconciliation` });
  if (instance.auditBroken) found.push({ kind: 'audit-broken', detail: instance.auditBroken });
  else if (instance.auditHead - instance.auditSeq > AUDIT_BEHIND)
    found.push({
      kind: 'audit-behind',
      detail: `${instance.auditHead - instance.auditSeq} audit events not forwarded`,
    });
  const desired = desiredRelease(state, instance.id);
  if (desired && instance.staged !== desired.id)
    found.push({
      kind: 'release-drift',
      detail: `Channel ${instance.channel} assigns ${desired.id}; staged ${instance.staged ?? 'nothing'}`,
    });
  if (instance.bestBefore && pastBestBefore(instance.bestBefore, at))
    found.push({
      kind: 'past-best-before',
      detail: `Runs a build past its best-before date of ${instance.bestBefore}`,
    });
  return found.map((issue) => ({ instance: instance.id, ...issue }));
}

/**
 * Instance reads, labels, channels and removal, health, and the report and desired-release protocol
 * calls.
 */
export function instanceHandlers(): HandlerContribution<AppState, Services>[] {
  return [
    collectionListHandler<AppState, Services, List, Instance>(instances, operations.instanceList, {
      store,
      visible,
      order: (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
      searchText: (instance) => [instance.id, instance.label ?? '', instance.application].join(' '),
    }),
    collectionGetHandler<AppState, Services, Get, Instance>(instances, operations.instanceGet, {
      store,
      visible,
    }),
    handler(operations.instanceUpdate, (input, ctx) => {
      if (
        input.channel !== undefined &&
        !records(ctx, channels, ctx.state.channels).has(input.channel)
      )
        throw new ApplicationError('NOT_FOUND', `Channel ${input.channel} does not exist`);
      return instancesOf(ctx).update(input.id, (instance) => {
        if (input.label !== undefined) instance.label = input.label;
        if (input.channel !== undefined) instance.channel = input.channel;
      });
    }),
    // The record and its relay requests go; forwarded audit events stay as the audit trail. A
    // instance whose device link still works reports again and comes back as a new record.
    handler(operations.instanceRemove, (input, ctx) => {
      instancesOf(ctx).remove(input.id);
      const requests = records(ctx, relays, ctx.state.relays);
      for (const relay of requests.values())
        if (relay.instance === input.id) requests.remove(relay.id);
      return { removed: true };
    }),
    handler(operations.fleetHealth, (_input, ctx) => {
      const at = now(ctx);
      const all = Object.values(ctx.state.instances);
      return {
        instances: all.length,
        issues: all.flatMap((instance) => issues(instance, ctx.state, at)),
      };
    }),
    handler(fleetInstanceOperations.report, (input, ctx) => {
      const id = callingInstance(ctx);
      const instance = instancesOf(ctx);
      const fields = {
        application: input.application,
        instance: input.instance,
        lastSeenAt: now(ctx),
        pending: input.outbox.pending,
        held: input.outbox.held,
        acknowledged: input.outbox.acknowledged,
        targets: input.outbox.targets,
        ...(input.auditHead === undefined ? {} : { auditHead: input.auditHead }),
      };
      if (!instance.has(id))
        instance.insert(id, { id, auditHead: 0, auditSeq: 0, auditHash: AUDIT_GENESIS, ...fields });
      instance.update(id, (record) => {
        Object.assign(record, fields);
        if (input.staged) record.staged = input.staged.release;
        else delete record.staged;
        if (input.bestBefore) record.bestBefore = input.bestBefore;
        else delete record.bestBefore;
      });
      return {};
    }),
    handler(fleetInstanceOperations.desired, (_input, ctx) => {
      const release = desiredRelease(ctx.state, callingInstance(ctx));
      return release
        ? {
            release: compact({
              id: release.id,
              version: release.version,
              manifest: release.manifest,
              signature: release.signature,
            }),
          }
        : {};
    }),
  ];
}
