import { ApplicationError } from '@tortoise/contracts';
import {
  createHandlerFactory,
  type HandlerContext,
  type HandlerContribution,
} from '@tortoise/runtime';
import { byKind } from '@tortoise/assignments/server';
import { requestOperations, type TestRequestsServices } from '@tortoise/pattern-base/server';
import { samplingOperations } from './contracts';
import type { TestRequestsAssignmentsRoot } from './domain';

type Context = HandlerContext<TestRequestsAssignmentsRoot, TestRequestsServices>;
const bind = createHandlerFactory<TestRequestsAssignmentsRoot, TestRequestsServices>();
const requestsOf = (ctx: Context) => Object.values(ctx.state.testRequests.requests);
const transformersIn = (scope: Record<string, unknown>) => scope.transformers as string[];

/** The transformer's most recently changed test request, or undefined when it has none. */
function lastRequest(ctx: Context, transformer: string) {
  return requestsOf(ctx)
    .filter((request) => request.transformer === transformer)
    .sort((a, b) => b.updatedAt - a.updatedAt)[0];
}

/** The members of the lab, by principal. */
export function createSamplingHandlers(): HandlerContribution<
  TestRequestsAssignmentsRoot,
  TestRequestsServices
>[] {
  return [
    bind(samplingOperations.assigneeList, (_input, ctx) => ({
      items: Object.entries(ctx.state.testRequests.members)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([id, role]) => ({ type: 'person' as const, id, label: `${id} (${role})` })),
    })),
  ];
}

/**
 * The sampling kind's hooks. The scope names each transformer once; the brief adds each
 * transformer's last sample and method in the lab when the round is sent; a report is about one
 * transformer of the round; accepting it submits a test request for the sample through
 * `test-request.submit`, as the technician accepting, with the method they assign.
 */
export const samplingHooks = {
  newId: (ctx: Context) => (ctx.services.newId ?? (() => crypto.randomUUID()))(),
  now: (ctx: Context) => (ctx.services.now ?? Date.now)(),
  ...byKind<Context>({
    sampling: {
      scope: (scope) => {
        const transformers = transformersIn(scope);
        if (new Set(transformers).size !== transformers.length)
          throw new ApplicationError('INVALID_INPUT', 'A transformer is listed twice', {
            field: 'scope',
          });
      },
      brief: (assignment, ctx) => ({
        substation: assignment.scope.substation as string,
        transformers: transformersIn(assignment.scope).map((transformer) => {
          const last = lastRequest(ctx, transformer);
          return { transformer, lastSample: last?.sample ?? '', lastMethod: last?.method ?? '' };
        }),
      }),
      subject: (subject, assignment) => transformersIn(assignment.scope).includes(subject),
      accept: async (report, input, _assignment, ctx) => {
        if (!report.subject)
          throw new ApplicationError(
            'CONFLICT',
            'Link the report to a transformer before accepting it',
          );
        const sample = report.body.sample as string;
        if (requestsOf(ctx).some((request) => request.sample === sample))
          throw new ApplicationError('CONFLICT', `Sample ${sample} already has a test request`);
        const method = input.method as string | undefined;
        await ctx.invoke(requestOperations.requestSubmit, {
          sample,
          transformer: report.subject,
          description: report.body.description as string,
          ...(method ? { method } : {}),
        });
      },
    },
  }),
};
