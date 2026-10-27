import { ApplicationError, type AnyCapability, type SyncBatch } from '@agent-native/contracts';
import {
  connectTarget,
  createPeerCall,
  createPeerDrift,
  createPeerPort,
  targetHandlers,
  targetRules,
  type PeerClient,
  type PeerPortOptions,
  type TargetCursor,
  type TargetIntegration,
} from '@agent-native/integration';
import type { ConnectContext } from '@agent-native/kernel';
import {
  own,
  put,
  type EffectOutcome,
  type HandlerContext,
  type HandlerContribution,
} from '@agent-native/runtime';
import { camel } from '../operations';
import type { AnyFeedItemOf, StoredBody } from '../schemas';
import type { Worklist } from '../worklist';
import { blobRefsOf } from './slice';

type Delivery = 'pending' | 'accepted' | 'rejected';
type Rejection = { code: string; message: string };

/** An assignment as the assignee keeps it: the issuer's feed item and what was done here. */
export interface WorklistAssignment {
  readonly id: string;
  readonly kind: string;
  title: string;
  note?: string;
  brief: StoredBody;
  sentAt: number;
  /** The issuer's last feed listed it. */
  listed: boolean;
  /** Marked done here; a refused done mark clears it again. */
  done: boolean;
  doneEffectId?: string;
  doneSync?: Delivery;
  rejection?: Rejection;
}

/** A report recorded here and the delivery that carries it to the issuer. */
export interface WorklistReport {
  readonly id: string;
  readonly assignmentId: string;
  readonly kind: string;
  readonly subject?: string;
  readonly body: StoredBody;
  readonly reportedAt: number;
  readonly effectId: string;
  sync: Delivery;
  rejection?: Rejection;
}

/** The worklist's part of the assignee application's state. */
export interface WorklistSlice {
  readonly assignments: Record<string, WorklistAssignment>;
  readonly reports: Record<string, WorklistReport>;
  readonly cursor: TargetCursor;
}

export const createWorklistSlice = (): WorklistSlice => ({
  assignments: {},
  reports: {},
  cursor: {},
});

export interface WorklistHandlerOptions<State, Services> {
  /** The worklist's slice in the application's state. */
  readonly slice: (state: State) => WorklistSlice;
  /** A new report ID; `crypto.randomUUID()` when omitted. The issuer keeps it. */
  readonly newId?: (context: HandlerContext<State, Services>) => string;
  /** The current time in milliseconds; `Date.now()` when omitted. */
  readonly now?: (context: HandlerContext<State, Services>) => number;
  /**
   * Called in the feed's transaction for each assignment the feed brings here for the first
   * time, after it is stored, for example to enqueue a notice to the assignee.
   */
  readonly arrived?: (
    assignment: WorklistAssignment,
    context: HandlerContext<State, Services>,
  ) => void;
}

const compact = <T extends object>(value: T): T =>
  Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T;

function presentAssignment(slice: WorklistSlice, assignment: WorklistAssignment) {
  const { listed, doneEffectId: _effect, ...shown } = assignment;
  const reports = Object.values(slice.reports).filter(
    (report) => report.assignmentId === assignment.id,
  ).length;
  return compact({ ...shown, open: listed && !assignment.done, reports });
}
const presentReport = ({ effectId: _effect, ...shown }: WorklistReport) => compact(shown);

/**
 * The handlers of a worklist, over its slice in the application's state. A report and a done mark
 * are recorded here and enqueued for the issuer in the same transaction, so they wait out a lost
 * connection. The issuer takes a report after the done mark too, so a report whose delivery was
 * retried is not lost. The feed applies as the issuer's whole open set: an assignment it no
 * longer lists stops taking reports here. A refused done mark reopens the assignment.
 *
 * The issuer authorizes every delivery again as this application's principal there, so nothing
 * here widens what the assignee may do at the issuer.
 */
export function worklistHandlers<State, Services, K extends Worklist['kinds'][number]>(
  worklist: Worklist<K>,
  options: WorklistHandlerOptions<State, Services>,
): HandlerContribution<State, Services>[] {
  type Ctx = HandlerContext<State, Services>;
  const { operations, target, types } = worklist;
  const now = (ctx: Ctx) => options.now?.(ctx) ?? Date.now();
  const issuerCommand = (id: string) => {
    const found = target.surface.commands.find((command) => command.id === id);
    if (!found) throw new Error(`The peer surface of ${target.surface.application} lacks ${id}`);
    return found as Parameters<typeof target.effect>[0];
  };
  const complete = issuerCommand('assignment.complete');
  const assignmentResource = (id: string) => `${types.assignment}:${id}`;
  const reportResource = (id: string) => `${types.report}:${id}`;
  const missing = () => new ApplicationError('NOT_FOUND', 'Assignment unavailable');
  const handler = <I>(
    capability: AnyCapability,
    handle: (input: I, ctx: Ctx) => unknown,
  ): HandlerContribution<State, Services> =>
    ({ capability, handle }) as unknown as HandlerContribution<State, Services>;

  const reports = worklist.kinds.map((kind) => {
    const report = issuerCommand(`assignment.${kind.id}.report`);
    const capability = (operations as unknown as Record<string, AnyCapability>)[
      `${camel(kind.id)}Report`
    ]!;
    return handler<{ assignmentId: string; subject?: string; body: StoredBody }>(
      capability,
      (input, ctx) => {
        const slice = options.slice(ctx.state);
        const assignment = own(slice.assignments, input.assignmentId);
        if (!assignment || assignment.kind !== kind.id) throw missing();
        if (!assignment.listed || assignment.done)
          throw new ApplicationError('CONFLICT', 'The assignment takes no more reports');
        const id = options.newId?.(ctx) ?? crypto.randomUUID();
        if (own(slice.reports, id))
          throw new ApplicationError('CONFLICT', 'Report already recorded');
        const resource = reportResource(id);
        // The blobs stay readable through the report, so the peer port can upload them.
        for (const ref of blobRefsOf(input.body)) ctx.attach(resource, ref);
        const subject = input.subject === undefined ? {} : { subject: input.subject };
        const effectId = ctx.enqueue(
          target.effect(report, {
            resource,
            payload: { id, assignmentId: assignment.id, ...subject, body: input.body } as never,
          }),
        );
        const stored: WorklistReport = {
          id,
          assignmentId: assignment.id,
          kind: kind.id,
          ...subject,
          body: input.body,
          reportedAt: now(ctx),
          effectId,
          sync: 'pending',
        };
        put(slice.reports, id, stored);
        ctx.change(resource, 'recorded');
        ctx.change(assignmentResource(assignment.id), 'reported');
        return presentReport(stored);
      },
    );
  });

  const settle = (
    record: { sync?: Delivery; doneSync?: Delivery; rejection?: Rejection },
    key: 'sync' | 'doneSync',
    outcome: EffectOutcome,
  ) => {
    record[key] = outcome.status === 'rejected' ? 'rejected' : 'accepted';
    if (outcome.status === 'rejected')
      record.rejection = { code: outcome.code, message: outcome.message };
    else delete record.rejection;
  };

  return [
    handler(operations.assignmentList, (_input, ctx) => {
      const slice = options.slice(ctx.state);
      return {
        items: Object.values(slice.assignments)
          .sort((a, b) => b.sentAt - a.sentAt)
          .map((assignment) => presentAssignment(slice, assignment)),
      };
    }),
    handler<{ id: string }>(operations.assignmentGet, (input, ctx) => {
      const slice = options.slice(ctx.state);
      const assignment = own(slice.assignments, input.id);
      if (!assignment) throw missing();
      return presentAssignment(slice, assignment);
    }),
    handler<{ assignmentId?: string }>(operations.reportList, (input, ctx) => ({
      items: Object.values(options.slice(ctx.state).reports)
        .filter((report) => !input.assignmentId || report.assignmentId === input.assignmentId)
        .sort((a, b) => b.reportedAt - a.reportedAt)
        .map(presentReport),
    })),
    handler<{ id: string }>(operations.complete, (input, ctx) => {
      const slice = options.slice(ctx.state);
      const assignment = own(slice.assignments, input.id);
      if (!assignment) throw missing();
      if (assignment.done) return presentAssignment(slice, assignment);
      if (!assignment.listed)
        throw new ApplicationError('CONFLICT', 'The issuer no longer lists the assignment');
      const resource = assignmentResource(assignment.id);
      assignment.doneEffectId = ctx.enqueue(
        target.effect(complete, { resource, payload: { id: assignment.id } as never }),
      );
      assignment.done = true;
      assignment.doneSync = 'pending';
      delete assignment.rejection;
      ctx.change(resource, 'done');
      return presentAssignment(slice, assignment);
    }),
    ...(targetHandlers<State, Services, AnyFeedItemOf<K>, unknown, object>(target, {
      cursor: (state) => options.slice(state).cursor,
      now,
      onOutcome(effect, outcome, ctx) {
        const slice = options.slice(ctx.state);
        if (effect.resource.startsWith(`${types.report}:`)) {
          const report = own(slice.reports, effect.resource.slice(types.report.length + 1));
          if (!report || report.effectId !== effect.id)
            throw new ApplicationError('NOT_FOUND', 'Report unavailable');
          settle(report, 'sync', outcome);
          ctx.change(effect.resource, report.sync);
          return;
        }
        const assignment = own(
          slice.assignments,
          effect.resource.slice(types.assignment.length + 1),
        );
        if (!assignment || assignment.doneEffectId !== effect.id)
          throw new ApplicationError('NOT_FOUND', 'Done mark unavailable');
        settle(assignment, 'doneSync', outcome);
        // A refused done mark reopens the assignment, so the assignee can keep working on it.
        if (outcome.status === 'rejected') assignment.done = false;
        ctx.change(effect.resource, assignment.doneSync!);
      },
      applyBatch({ items }: SyncBatch<AnyFeedItemOf<K>, unknown>, ctx) {
        const slice = options.slice(ctx.state);
        const listed = new Set(items.map((item) => item.id));
        for (const item of items) {
          // The issuer's fields replace the held copy; the done mark made here is kept.
          const held = own(slice.assignments, item.id);
          const local = held
            ? {
                done: held.done,
                ...compact({
                  doneEffectId: held.doneEffectId,
                  doneSync: held.doneSync,
                  rejection: held.rejection,
                }),
              }
            : { done: false };
          put(slice.assignments, item.id, {
            ...(item as unknown as WorklistAssignment),
            ...local,
            listed: true,
          });
          ctx.change(assignmentResource(item.id), 'synced');
          if (!held) options.arrived?.(own(slice.assignments, item.id)!, ctx);
        }
        // The feed is the issuer's whole open set: what it left out takes no more reports.
        for (const assignment of Object.values(slice.assignments))
          if (assignment.listed && !listed.has(assignment.id)) {
            assignment.listed = false;
            ctx.change(assignmentResource(assignment.id), 'unlisted');
          }
        return items.length;
      },
      status(ctx) {
        const slice = options.slice(ctx.state);
        const states = [
          ...Object.values(slice.reports).map((report) => report.sync),
          ...Object.values(slice.assignments).flatMap((item) => item.doneSync ?? []),
        ];
        const count = (state: Delivery) => states.filter((item) => item === state).length;
        return {
          pending: count('pending'),
          accepted: count('accepted'),
          rejected: count('rejected'),
        };
      },
    }) as HandlerContribution<State, Services>[]),
    ...reports,
  ];
}

/**
 * The worklist's rows for `definePolicy`: its target's settle and sync belong to the integration
 * lane, and every other operation is open to the callers the application's gate admits. The
 * application adds `{ is, operations: worklist.target.integrationOperations }` to its
 * integrations, and event rules for `worklist.types` and `sync`.
 */
export function worklistRules(worklist: Worklist): Record<string, 'open' | 'integration'> {
  const rules: Record<string, 'open' | 'integration'> = {};
  for (const capability of Object.values(worklist.operations) as AnyCapability[])
    rules[capability.id] = 'open';
  return { ...rules, ...targetRules(worklist.target) };
}

/**
 * The worklist's integration: the outbox delivers reports and done marks to the issuer's own API,
 * and inbound sync pulls the issuer's `assignment.feed`, both through `client`. Over hub-link the
 * client is `network.client(target)`; over peer-link it is the link's service client. A change to
 * one of the lane's operations at the issuer holds deliveries and pulls until the two agree.
 */
export function connectWorklist<K extends Worklist['kinds'][number]>(
  worklist: Worklist<K>,
  options: {
    readonly application: ConnectContext['application'];
    readonly workspaceId: string;
    /** The principal that delivers to the issuer and applies its feed. */
    readonly principalId: string;
    readonly client: () => PeerClient;
    readonly reconnect?: PeerPortOptions['reconnect'];
  },
): TargetIntegration<AnyFeedItemOf<K>> {
  const { application, workspaceId, client, target } = { ...options, target: worklist.target };
  const drift = createPeerDrift({
    surface: target.surface,
    contract: () => createPeerCall({ client }).contract(),
  });
  return connectTarget<AnyFeedItemOf<K>>({
    target,
    application,
    workspaceId,
    principalId: options.principalId,
    port: createPeerPort<AnyFeedItemOf<K>>({
      target: target.target,
      client,
      readBlob: (effect, digest) => application.readEffectBlob(workspaceId, effect.id, digest),
      ...(target.feedQuery ? { feed: target.feedQuery } : {}),
      drift,
      ...(options.reconnect ? { reconnect: options.reconnect } : {}),
    }),
  });
}
