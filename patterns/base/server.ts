/**
 * What an application that composes the test requests module imports: the module, its handlers,
 * its policy and its state. The extensions in `patterns/*` import these unchanged.
 */
export {
  testRequestsModule,
  requestOperations,
  testRequestCollection,
  testRequestSchema,
  testRequestRecordSchema,
  type TestRequest,
  type TestRequestRecord,
} from './contracts';
export { createTestRequestsState, type TestRequestsState, type Role } from './domain';
export { createTestRequestsHandlers, type TestRequestsServices } from './handlers';
export { testRequestsPolicy } from './policy';
