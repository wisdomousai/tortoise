import type { z } from 'zod';
import { ApplicationError, AUDIT_GENESIS } from '@agent-native/contracts';
import { fleetSiteOperations } from '@agent-native/fleet-agent/contracts';
import { pastBestBefore } from '@agent-native/kernel/build';
import {
  collectionGetHandler,
  collectionListHandler,
  records,
  type HandlerContribution,
} from '@agent-native/runtime';
import { operations } from '../contracts';
import { relays } from '../contracts/relay';
import { channels } from '../contracts/releases';
import { healthSchema, sites, type Site } from '../contracts/sites';
import { desiredRelease, siteIdOf, type AppState } from '../domain';
import { compact, handler, now, type Context, type Services } from './context';

type List = typeof operations.siteList;
type Get = typeof operations.siteGet;
const store = (state: AppState) => state.sites;
const visible = () => true;
const sitesOf = (ctx: Context) => records(ctx, sites, ctx.state.sites);

/** A site not heard from for this long is stale. */
export const STALE_MS = 15 * 60_000;
/** Audit forwarding this many events behind the site's head needs a look. */
const AUDIT_BEHIND = 1000;

/** The calling site's ID. Only the device allowlist reaches the protocol, so this is a guard. */
export function callingSite(ctx: Context): string {
  const id = siteIdOf(ctx.context.principalId);
  if (id === undefined)
    throw new ApplicationError('FORBIDDEN', 'Only an enrolled site calls the fleet protocol');
  return id;
}

/** The calling site's record; NOT_FOUND until its first report. */
export function reportedSite(ctx: Context): Site {
  return sitesOf(ctx).getExisting(callingSite(ctx), 'Report before anything else');
}

type Issue = z.output<typeof healthSchema>['issues'][number];

function issues(site: Site, state: AppState, at: number): Issue[] {
  const found: Omit<Issue, 'site'>[] = [];
  if (at - site.lastSeenAt > STALE_MS)
    found.push({
      kind: 'stale',
      detail: `No report since ${new Date(site.lastSeenAt).toISOString()}`,
    });
  if (site.held)
    found.push({ kind: 'held', detail: `${site.held} effects held for reconciliation` });
  if (site.auditBroken) found.push({ kind: 'audit-broken', detail: site.auditBroken });
  else if (site.auditHead - site.auditSeq > AUDIT_BEHIND)
    found.push({
      kind: 'audit-behind',
      detail: `${site.auditHead - site.auditSeq} audit events not forwarded`,
    });
  const desired = desiredRelease(state, site.id);
  if (desired && site.staged !== desired.id)
    found.push({
      kind: 'release-drift',
      detail: `Channel ${site.channel} assigns ${desired.id}; staged ${site.staged ?? 'nothing'}`,
    });
  if (site.bestBefore && pastBestBefore(site.bestBefore, at))
    found.push({
      kind: 'past-best-before',
      detail: `Runs a build past its best-before date of ${site.bestBefore}`,
    });
  return found.map((issue) => ({ site: site.id, ...issue }));
}

/**
 * Site reads, labels, channels and removal, health, and the report and desired-release protocol
 * calls.
 */
export function siteHandlers(): HandlerContribution<AppState, Services>[] {
  return [
    collectionListHandler<AppState, Services, List, Site>(sites, operations.siteList, {
      store,
      visible,
      order: (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
      searchText: (site) => [site.id, site.label ?? '', site.application].join(' '),
    }),
    collectionGetHandler<AppState, Services, Get, Site>(sites, operations.siteGet, {
      store,
      visible,
    }),
    handler(operations.siteUpdate, (input, ctx) => {
      if (
        input.channel !== undefined &&
        !records(ctx, channels, ctx.state.channels).has(input.channel)
      )
        throw new ApplicationError('NOT_FOUND', `Channel ${input.channel} does not exist`);
      return sitesOf(ctx).update(input.id, (site) => {
        if (input.label !== undefined) site.label = input.label;
        if (input.channel !== undefined) site.channel = input.channel;
      });
    }),
    // The record and its relay requests go; forwarded audit events stay as the audit trail. A
    // site whose device link still works reports again and comes back as a new record.
    handler(operations.siteRemove, (input, ctx) => {
      sitesOf(ctx).remove(input.id);
      const requests = records(ctx, relays, ctx.state.relays);
      for (const relay of requests.values()) if (relay.site === input.id) requests.remove(relay.id);
      return { removed: true };
    }),
    handler(operations.fleetHealth, (_input, ctx) => {
      const at = now(ctx);
      const all = Object.values(ctx.state.sites);
      return { sites: all.length, issues: all.flatMap((site) => issues(site, ctx.state, at)) };
    }),
    handler(fleetSiteOperations.report, (input, ctx) => {
      const id = callingSite(ctx);
      const site = sitesOf(ctx);
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
      if (!site.has(id))
        site.insert(id, { id, auditHead: 0, auditSeq: 0, auditHash: AUDIT_GENESIS, ...fields });
      site.update(id, (record) => {
        Object.assign(record, fields);
        if (input.staged) record.staged = input.staged.release;
        else delete record.staged;
        if (input.bestBefore) record.bestBefore = input.bestBefore;
        else delete record.bestBefore;
      });
      return {};
    }),
    handler(fleetSiteOperations.desired, (_input, ctx) => {
      const release = desiredRelease(ctx.state, callingSite(ctx));
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
