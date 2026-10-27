import { randomUUID } from 'node:crypto';
import {
  collectionGetHandler,
  collectionListHandler,
  createHandlerFactory,
  records,
  type HandlerContext,
  type HandlerContribution,
} from '@agent-native/runtime';
import { requestOperations, testRequests, type TestRequest } from './contracts';
import type { LabRequestsState } from './domain';

export interface LabRequestsServices {
  /** Test request ids; random UUIDs when omitted. */
  newId?: () => string;
  /** Instance clock for `updatedAt`. */
  now?: () => number;
}
type Context = HandlerContext<LabRequestsState, LabRequestsServices>;

const bind = createHandlerFactory<LabRequestsState, LabRequestsServices>();
const now = (ctx: Context) => (ctx.services.now ?? Date.now)();
const requestsOf = (ctx: Context) => records(ctx, testRequests, ctx.state.requests);
/** Every member sees every request; the policy's caller gate keeps everyone else out. */
const visible = () => true;
const store = (state: LabRequestsState) => state.requests;
/** Reads add the request's current revision, which a change passes back as `expectedRevisions`. */
const present = (request: TestRequest, ctx: Context) => ({
  ...request,
  revision: ctx.getRevision(`${testRequests.type}:${request.id}`),
});

/**
 * The handlers of the lab requests module, written against the `labRequests` slice. An
 * application that composes the module passes them through `sliceHandlers('labRequests', ...)`.
 */
export function createLabRequestsHandlers(): HandlerContribution<
  LabRequestsState,
  LabRequestsServices
>[] {
  return [
    collectionListHandler<
      LabRequestsState,
      LabRequestsServices,
      typeof requestOperations.requestList,
      TestRequest
    >(testRequests, requestOperations.requestList, {
      store,
      visible,
      present,
      order: (a, b) => b.updatedAt - a.updatedAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
      searchText: (request) => `${request.specimen} ${request.method} ${request.description}`,
    }),
    collectionGetHandler<
      LabRequestsState,
      LabRequestsServices,
      typeof requestOperations.requestGet,
      TestRequest
    >(testRequests, requestOperations.requestGet, { store, visible, present }),
    bind(requestOperations.requestSubmit, (input, ctx) => {
      const id = (ctx.services.newId ?? randomUUID)();
      return requestsOf(ctx).insert(id, {
        id,
        specimen: input.specimen,
        description: input.description,
        method: input.method ?? '',
        requester: ctx.context.principalId,
        updatedAt: now(ctx),
      });
    }),
    bind(requestOperations.requestUpdate, (input, ctx) =>
      requestsOf(ctx).update(input.id, (request) => {
        if (input.specimen !== undefined) request.specimen = input.specimen;
        if (input.description !== undefined) request.description = input.description;
        if (input.method !== undefined) request.method = input.method;
        request.updatedAt = now(ctx);
      }),
    ),
  ];
}
