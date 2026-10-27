/**
 * What an application that composes the lab requests module imports: the module, its handlers,
 * its policy and its state. The extensions in `samples/*` import these unchanged.
 */
export {
  labRequestsModule,
  requestOperations,
  testRequests,
  testRequestSchema,
  testRequestRecordSchema,
  type TestRequest,
  type TestRequestRecord,
} from './contracts';
export { createLabRequestsState, type LabRequestsState, type Role } from './domain';
export { createLabRequestsHandlers, type LabRequestsServices } from './handlers';
export { labRequestsPolicy } from './policy';
