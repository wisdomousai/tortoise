import { z } from 'zod';
import {
  collectionGet,
  collectionList,
  defineAgent,
  defineCapability,
  defineCollection,
  defineModule,
  jsonSchema,
  recordKeySchema,
} from '@agent-native/contracts';

/** Summary statistics of one result's readings, as the result analyst's tool computes them. */
export const analysisSchema = z.strictObject({
  count: z.number().int().positive(),
  mean: z.number(),
  min: z.number(),
  max: z.number(),
  /** Sample standard deviation; 0 for a single reading. */
  stdev: z.number().nonnegative(),
});
export type Analysis = z.output<typeof analysisSchema>;

/**
 * The breakdown voltages measured on a test request's oil sample, one per fill of the test
 * cell, in kV, and their analysis.
 * `analysisRun` is the run that recorded the analysis, absent when a technician entered it.
 */
export const testResultSchema = z.strictObject({
  id: recordKeySchema,
  request: recordKeySchema,
  readings: z.array(z.number().positive().max(10_000)).min(1).max(100),
  recordedBy: z.string().min(1).max(128),
  analysis: analysisSchema.optional(),
  analysisRun: z.string().min(1).max(128).optional(),
});
export type TestResult = z.output<typeof testResultSchema>;

export const testResults = defineCollection({
  type: 'test-result',
  resourceType: 'TestResult',
  item: testResultSchema,
  label: { one: 'Test result', many: 'Test results' },
  fields: [{ name: 'request' }, { name: 'recordedBy', label: 'Recorded by' }],
});

const write = { action: 'write', resourceType: 'TestResult' };

/** Recording readings and their analysis. Browser-safe. */
export const resultOperations = {
  resultList: collectionList(testResults, {
    id: 'test-result',
    description: 'List test results. Filter by request to see the results of one test request.',
    filters: ['request'],
  }),
  resultGet: collectionGet(testResults, {
    id: 'test-result',
    description: 'Read one test result by id, with its readings and analysis.',
    ui: {
      exception:
        'Read by the tool of the result analyst in its sandbox; the request screen lists results with test-result.list.',
    },
  }),
  resultRecord: defineCapability({
    id: 'test-result.record',
    kind: 'command',
    description:
      'Record the breakdown voltage of each fill of the test cell for a test request, in kV. Technicians only.',
    input: jsonSchema(
      z.strictObject({
        request: testResultSchema.shape.request,
        readings: testResultSchema.shape.readings,
      }),
    ),
    output: jsonSchema(testResultSchema),
    permission: write,
    dependencies: ['test-result', 'test-request'],
    ui: { binding: 'test-result.record' },
    display: { label: 'Record readings', resource: 'test-result' },
  }),
  resultAnalyze: defineCapability({
    id: 'test-result.analyze',
    kind: 'command',
    description:
      'Record the summary statistics of the readings of a test result: count, mean, minimum, maximum and sample standard deviation. Technicians only. A run is recorded with the analysis.',
    input: jsonSchema(analysisSchema.extend({ id: recordKeySchema })),
    output: jsonSchema(testResultSchema),
    permission: write,
    dependencies: ['test-result'],
    ui: { binding: 'test-result.analyze' },
    display: { label: 'Record statistics', resource: 'test-result' },
  }),
} as const;

/**
 * Reads one test result and records its statistics. A run is scoped to the result it was started
 * on, so its tool cannot analyze another one.
 */
export const resultAnalyst = defineAgent({
  id: 'test-result.analyst',
  title: 'Result analyst',
  instructions:
    'Read the test result with test-result.get, compute the count, mean, minimum, maximum and sample standard deviation of its readings, and record them with test-result.analyze.',
  operations: [resultOperations.resultGet.id, resultOperations.resultAnalyze.id],
  resourceTypes: ['test-result'],
  model: 'any',
  output: 'direct',
  budgets: { turns: 1, toolCalls: 4, wallTimeMs: 60_000 },
});

export const testResultsModule = defineModule({
  id: 'test-results',
  capabilities: Object.values(resultOperations),
  agents: [resultAnalyst],
});
