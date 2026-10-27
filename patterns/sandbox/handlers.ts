import { randomUUID } from 'node:crypto';
import {
  collectionGetHandler,
  collectionListHandler,
  createHandlerFactory,
  records,
  type HandlerContext,
  type HandlerContribution,
} from '@agent-native/runtime';
import {
  testRequestCollection,
  type TestRequestsServices,
} from '@agent-native/pattern-base/server';
import { resultOperations, testResults, type TestResult } from './contracts';
import type { TestRequestsSandboxRoot } from './domain';

type Root = TestRequestsSandboxRoot;
type Context = HandlerContext<Root, TestRequestsServices>;

const bind = createHandlerFactory<Root, TestRequestsServices>();
const store = (state: Root) => state.testResults.results;
const resultsOf = (ctx: Context) => records(ctx, testResults, ctx.state.testResults.results);
/** Every member sees every result, as every member sees every test request. */
const visible = () => true;

/**
 * The test results handlers. They are written against the whole state, because recording a
 * result checks that its test request exists in the base pattern's slice.
 */
export function createResultHandlers(): HandlerContribution<Root, TestRequestsServices>[] {
  return [
    collectionListHandler<
      Root,
      TestRequestsServices,
      typeof resultOperations.resultList,
      TestResult
    >(testResults, resultOperations.resultList, { store, visible }),
    collectionGetHandler<Root, TestRequestsServices, typeof resultOperations.resultGet, TestResult>(
      testResults,
      resultOperations.resultGet,
      { store, visible },
    ),
    bind(resultOperations.resultRecord, (input, ctx) => {
      records(ctx, testRequestCollection, ctx.state.testRequests.requests).getExisting(
        input.request,
        'Test request unavailable',
      );
      const id = (ctx.services.newId ?? randomUUID)();
      return resultsOf(ctx).insert(id, {
        id,
        request: input.request,
        readings: [...input.readings],
        recordedBy: ctx.context.principalId,
      });
    }),
    bind(resultOperations.resultAnalyze, ({ id, ...analysis }, ctx) =>
      resultsOf(ctx).update(id, (result) => {
        result.analysis = analysis;
        // From the caller's context, which the run's token carries; the tool cannot set it.
        if (ctx.context.runId) result.analysisRun = ctx.context.runId;
        else delete result.analysisRun;
      }),
    ),
  ];
}
