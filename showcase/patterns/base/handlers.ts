import { randomUUID } from 'node:crypto';
import {
  collectionGetHandler,
  collectionListHandler,
  createHandlerFactory,
  records,
  type HandlerContext,
  type HandlerContribution,
} from '@tortoise/runtime';
import { requestOperations, testRequestCollection, type TestRequest } from './contracts';
import type { TestRequestsState } from './domain';

export interface TestRequestsServices {
  /** Test request ids; random UUIDs when omitted. */
  newId?: () => string;
  /** Instance clock for `updatedAt`. */
  now?: () => number;
}
type Context = HandlerContext<TestRequestsState, TestRequestsServices>;

const bind = createHandlerFactory<TestRequestsState, TestRequestsServices>();
const now = (ctx: Context) => (ctx.services.now ?? Date.now)();
const requestsOf = (ctx: Context) => records(ctx, testRequestCollection, ctx.state.requests);
/** Every member sees every request; the policy's caller gate keeps everyone else out. */
const visible = () => true;
const store = (state: TestRequestsState) => state.requests;
/** Reads add the request's current revision, which a change passes back as `expectedRevisions`. */
const present = (request: TestRequest, ctx: Context) => ({
  ...request,
  revision: ctx.getRevision(`${testRequestCollection.type}:${request.id}`),
});

/**
 * The handlers of the test requests module, written against the `testRequests` slice. An
 * application that composes the module passes them through `sliceHandlers('testRequests', ...)`.
 */
export function createTestRequestsHandlers(): HandlerContribution<
  TestRequestsState,
  TestRequestsServices
>[] {
  return [
    collectionListHandler<
      TestRequestsState,
      TestRequestsServices,
      typeof requestOperations.requestList,
      TestRequest
    >(testRequestCollection, requestOperations.requestList, {
      store,
      visible,
      present,
      order: (a, b) => b.updatedAt - a.updatedAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
      searchText: (request) =>
        `${request.sample} ${request.transformer} ${request.method} ${request.description}`,
    }),
    collectionGetHandler<
      TestRequestsState,
      TestRequestsServices,
      typeof requestOperations.requestGet,
      TestRequest
    >(testRequestCollection, requestOperations.requestGet, { store, visible, present }),
    bind(requestOperations.requestSubmit, (input, ctx) => {
      const id = (ctx.services.newId ?? randomUUID)();
      return requestsOf(ctx).insert(id, {
        id,
        sample: input.sample,
        transformer: input.transformer,
        description: input.description,
        method: input.method ?? '',
        requester: ctx.context.principalId,
        updatedAt: now(ctx),
      });
    }),
    bind(requestOperations.requestUpdate, (input, ctx) =>
      requestsOf(ctx).update(input.id, (request) => {
        if (input.sample !== undefined) request.sample = input.sample;
        if (input.transformer !== undefined) request.transformer = input.transformer;
        if (input.description !== undefined) request.description = input.description;
        if (input.method !== undefined) request.method = input.method;
        request.updatedAt = now(ctx);
      }),
    ),
  ];
}
