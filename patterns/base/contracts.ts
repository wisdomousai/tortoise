import { z } from 'zod';
import {
  collectionGet,
  collectionList,
  defineCapability,
  defineCollection,
  defineModule,
  jsonSchema,
  recordKeySchema,
} from '@agent-native/contracts';

/**
 * One test request: an oil sample drawn from an installed power transformer, what the requester
 * wants tested, and the test method a technician assigns. `requester` is the principal who
 * submitted it.
 */
export const testRequestSchema = z.strictObject({
  id: recordKeySchema,
  sample: z.string().min(1).max(64),
  transformer: z.string().min(1).max(64),
  description: z.string().max(10_000),
  method: z.string().max(200),
  requester: z.string().min(1).max(128),
  updatedAt: z.number().int().nonnegative(),
});
export type TestRequest = z.output<typeof testRequestSchema>;

/** A test request as reads present it: the stored request and its current revision. */
export const testRequestRecordSchema = testRequestSchema.extend({
  revision: z.number().int().nonnegative(),
});
export type TestRequestRecord = z.output<typeof testRequestRecordSchema>;

export const testRequestCollection = defineCollection({
  type: 'test-request',
  resourceType: 'TestRequest',
  item: testRequestRecordSchema,
  label: { one: 'Test request', many: 'Test requests' },
  titleField: 'sample',
  fields: [
    { name: 'sample' },
    { name: 'transformer' },
    { name: 'method', label: 'Test method' },
    { name: 'description' },
    // `updatedAt` stays out: a JSON number carries no unit, so a screen would print the epoch.
    { name: 'requester', label: 'Submitted by' },
  ],
});

const write = { action: 'write', resourceType: 'TestRequest' };

/** Reading, submitting and changing test requests. Browser-safe. */
export const requestOperations = {
  requestList: collectionList(testRequestCollection, {
    id: 'test-request',
    description:
      'List test requests, most recently changed first. Search matches sample, transformer, method and description.',
    search: true,
  }),
  requestGet: collectionGet(testRequestCollection, {
    id: 'test-request',
    description:
      'Read one test request by id. Use its revision as test-request:<id> in expectedRevisions.',
  }),
  requestSubmit: defineCapability({
    id: 'test-request.submit',
    kind: 'command',
    description:
      'Submit a test request for an oil sample drawn from a transformer. Technicians only. The test method may be left empty for a technician to assign.',
    input: jsonSchema(
      z.strictObject({
        sample: testRequestSchema.shape.sample,
        transformer: testRequestSchema.shape.transformer,
        description: testRequestSchema.shape.description,
        method: testRequestSchema.shape.method.optional(),
      }),
    ),
    output: jsonSchema(testRequestSchema),
    permission: write,
    dependencies: ['test-request'],
    ui: { binding: 'test-request.submit' },
    display: { label: 'Submit test request', resource: 'test-request', titleField: 'sample' },
  }),
  requestUpdate: defineCapability({
    id: 'test-request.update',
    kind: 'command',
    description:
      'Change the sample, transformer, description or test method of a test request. Technicians only. Pass the revision you read as expectedRevisions so a concurrent change conflicts.',
    input: jsonSchema(
      z.strictObject({
        id: recordKeySchema,
        sample: testRequestSchema.shape.sample.optional(),
        transformer: testRequestSchema.shape.transformer.optional(),
        description: testRequestSchema.shape.description.optional(),
        method: testRequestSchema.shape.method.optional(),
      }),
    ),
    output: jsonSchema(testRequestSchema),
    permission: write,
    dependencies: ['test-request'],
    ui: { binding: 'test-request.update' },
    display: { label: 'Save test request', resource: 'test-request', titleField: 'sample' },
  }),
} as const;

export const testRequestsModule = defineModule({
  id: 'test-requests',
  capabilities: Object.values(requestOperations),
  workflows: [
    {
      id: 'test-requests.assign-method',
      operations: ['test-request.list', 'test-request.get', 'test-request.update'],
      text: 'Find the test request with test-request.list, read it with test-request.get, then call test-request.update with the method and the revision you read as expectedRevisions.',
    },
  ],
});
